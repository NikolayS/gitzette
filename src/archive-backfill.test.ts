import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {readdir} from 'node:fs/promises';
import {Hono} from 'hono';
import {ARCHIVE_TARGETS,ARCHIVE_PROFILES,archiveEnqueueSql,enqueueIdleArchiveJob} from './archive-backfill';
import {runnerRoutes} from './runner';
import type {Env} from './index';

async function fixture() {
 const db=new Database(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const f of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) db.exec(await Bun.file(`migrations/${f}`).text());
 for(const n of ARCHIVE_PROFILES) db.query('INSERT INTO users(id,username) VALUES(?,?)').run(n==='nikolays'?'1345402':n,n);
 return db;
}
const now=Math.floor(Date.now()/1000);
function enqueue(db:Database,budget=90,time=now) {db.query(archiveEnqueueSql()!).run('1345402',time-604800,time-21600,budget);}
function rows(db:Database) {return db.query('SELECT j.id,u.username,j.week_key,j.status FROM generation_jobs j JOIN users u ON u.id=j.user_id ORDER BY j.rowid').all();}
class Statement {
 args:(string|number|null)[]=[];
 constructor(private db:Database,private sql:string){}
 bind(...args:(string|number|null)[]){this.args=args;return this;}
 async first<T>(){return this.db.query(this.sql).get(...this.args) as T|null;}
 async all<T>(){return {results:this.db.query(this.sql).all(...this.args) as T[]};}
 async run(){const r=this.db.query(this.sql).run(...this.args);return {meta:{changes:r.changes},success:true};}
}
function env(db:Database):Env{return {DB:{prepare:(sql:string)=>new Statement(db,sql)},DISPATCHES:{list:async()=>({objects:[]}),delete:async()=>{}},RUNNER_SECRET:'expected',ADMIN_USER_ID:'1345402',ARCHIVE_BACKFILL_ENABLED:'true',ROLLING_7D_GLOBAL_GENERATION_LIMIT:'100'} as unknown as Env;}

test('archive scope is exactly the original 184 stable profile/week targets',()=>{
 expect(ARCHIVE_PROFILES).toEqual(['nikolays','torvalds','steipete','karpathy','dhh','mitchellh','dcramer','simonw']);
 expect(ARCHIVE_TARGETS.length).toBe(184);expect(new Set(ARCHIVE_TARGETS.map(t=>t.id)).size).toBe(184);
 for(const n of ARCHIVE_PROFILES)expect(ARCHIVE_TARGETS.filter(t=>t.username===n).map(t=>t.weekKey)).toEqual(Array.from({length:23},(_,i)=>`2026-W${i+10}`));
 expect(ARCHIVE_TARGETS.filter(t=>t.repair).map(t=>`${t.username}:${t.weekKey}`).sort()).toEqual(['nikolays:2026-W10','torvalds:2026-W13','torvalds:2026-W16','steipete:2026-W14','dhh:2026-W12','dhh:2026-W16','dcramer:2026-W12'].sort());
});
test('only the authorized existing owner and unsuppressed existing users can queue',async()=>{
 const db=await fixture();try{
 db.exec("INSERT INTO profile_suppressions(username,reason) VALUES('nikolays','test')");enqueue(db);expect(rows(db)).toEqual([]);
 db.exec("DELETE FROM profile_suppressions; DELETE FROM users WHERE id='1345402'");enqueue(db);expect(rows(db)).toEqual([]);
 db.exec("INSERT INTO users(id,username) VALUES('wrong','nikolays')");enqueue(db);expect(rows(db)).toEqual([]);
 }finally{db.close();}
});
test('existing editions, published jobs, suppressed profiles and terminal archive attempts are preserved',async()=>{
 const db=await fixture();try{
 db.exec("INSERT INTO dispatches(user_id,week_key,r2_key) VALUES('1345402','2026-W32','existing'); INSERT INTO profile_suppressions(username,reason) VALUES('torvalds','test'); INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('prior','steipete','1345402','2026-W32','published')");
 const target=ARCHIVE_TARGETS.find(t=>t.username==='karpathy'&&t.weekKey==='2026-W32')!;
 db.query("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES(?,'karpathy','1345402','2026-W32','permanent_failed')").run(target.id);
 enqueue(db);expect(rows(db).at(-1)).toMatchObject({username:'dhh',week_key:'2026-W32',status:'queued'});
 expect(db.query("SELECT r2_key FROM dispatches WHERE user_id='1345402'").get()).toEqual({r2_key:'existing'});
 expect(db.query("SELECT COUNT(*) n FROM generation_jobs WHERE user_id='karpathy'").get()).toEqual({n:1});
 }finally{db.close();}
});
test('pending reservations and used capacity bound enqueueing, then resume after the rolling window',async()=>{
 const db=await fixture();try{
 enqueue(db,1);enqueue(db,1);expect(rows(db).length).toBe(1);
 db.query("UPDATE generation_jobs SET status='published',capacity_started_at=?").run(now);
 enqueue(db,1);expect(rows(db).length).toBe(1);
 enqueue(db,1,now+604801);expect(rows(db).length).toBe(2);
 }finally{db.close();}
});
test('idle claim integrates opt-in archive work without preempting an ordinary job',async()=>{
 const db=await fixture();try{
 const app=new Hono<{Bindings:Env}>().route('/runner',runnerRoutes);const e=env(db);
 const req=()=>app.request('/runner/jobs/claim',{method:'POST',headers:{authorization:'Bearer expected'}},e);
 expect((await app.request('/runner/jobs/claim',{method:'POST'},e)).status).toBe(401);expect(rows(db)).toEqual([]);
 e.ARCHIVE_BACKFILL_ENABLED='false';expect((await req()).status).toBe(204);expect(rows(db)).toEqual([]);
 e.ARCHIVE_BACKFILL_ENABLED='true';expect((await req()).status).toBe(204);expect(rows(db).length).toBe(1);
 db.exec("UPDATE generation_jobs SET created_at=unixepoch()-10; INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('11111111-1111-4111-8111-111111111111','dhh','1345402','2026-W36','queued')");
 const ordinary=await req();expect(ordinary.status).toBe(200);expect(await ordinary.json()).toMatchObject({job:{username:'dhh',weekKey:'2026-W36'}});
 const response=await req();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({job:{username:'nikolays',weekKey:'2026-W32',status:'collecting'}});expect(rows(db).length).toBe(2);
 await expect(enqueueIdleArchiveJob({...e,ADMIN_USER_ID:'wrong'},now,100)).rejects.toThrow('authorized owner');
 }finally{db.close();}
});
test('only the explicitly audited legacy repair pages can regenerate existing content',async()=>{
 const db=await fixture();try{
 for(const t of ARCHIVE_TARGETS) db.query('INSERT INTO dispatches(user_id,week_key,r2_key) VALUES(?,?,?)').run(t.username==='nikolays'?'1345402':t.username,t.weekKey,`legacy/${t.username}/${t.weekKey}`);
 for(let i=0;i<10;i++)enqueue(db);
 expect(rows(db).map(r=>(r as {id:string}).id).sort()).toEqual(ARCHIVE_TARGETS.filter(t=>t.repair).map(t=>t.id).sort());
 expect(db.query('SELECT COUNT(*) n FROM dispatches WHERE r2_key LIKE ?').get('legacy/%')).toEqual({n:184});
 }finally{db.close();}
});
