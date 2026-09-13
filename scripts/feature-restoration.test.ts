import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {readdir} from 'node:fs/promises';
const dir=new URL('../migrations/',import.meta.url);
const repair=await Bun.file(new URL('0008_restore_owner_dispatch.sql',dir)).text();
async function fixture(){
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const n of (await readdir(dir)).sort().filter(n=>n.endsWith('.sql')))db.exec(await Bun.file(new URL(n,dir)).text());
 return db;
}
test('feature restoration queues exactly one owner edition, preserves old publication and is idempotent',async()=>{
 const db=await fixture();try{
 db.exec("INSERT INTO users(id,username) VALUES('1345402','nikolays'); INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('previous','1345402','1345402','2026-W36','published')");
 db.exec(repair);db.exec(repair);
 expect(db.query("SELECT week_key,status FROM generation_jobs WHERE id='restoration-nikolays-w36-20260913'").get()).toEqual({week_key:'2026-W36',status:'queued'});
 expect(db.query("SELECT status FROM generation_jobs WHERE id='previous'").get()).toEqual({status:'published'});
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:2});
 expect(db.query('SELECT COUNT(*) n FROM edition_versions').get()).toEqual({n:0});
 }finally{db.close();}
});
test('feature restoration respects missing owner, suppression and current work',async()=>{
 for(const mode of ['missing','suppressed','running']){
 const db=await fixture();try{
 if(mode!=='missing')db.exec("INSERT INTO users(id,username) VALUES('1345402','nikolays')");
 if(mode==='suppressed')db.exec("INSERT INTO profile_suppressions(username,reason) VALUES('nikolays','test')");
 if(mode==='running')db.exec("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('live','1345402','1345402','2026-W36','writing')");
 db.exec(repair);
 expect(db.query("SELECT COUNT(*) n FROM generation_jobs WHERE id='restoration-nikolays-w36-20260913'").get()).toEqual({n:0});
 }finally{db.close();}
 }
});
