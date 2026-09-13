import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {readdir} from 'node:fs/promises';
const dir=new URL('../migrations/',import.meta.url);
const recovery=await Bun.file(new URL('0007_revival_canaries.sql',dir)).text();
async function fixture(seed=true) {
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of (await readdir(dir)).sort().filter(n=>n.endsWith('.sql')&&!n.startsWith('0007_'))) db.exec(await Bun.file(new URL(name,dir)).text());
 if(seed) for(const [id,name] of [['1345402','nikolays'],['test-steipete','steipete'],['test-torvalds','torvalds'],['test-karpathy','karpathy'],['test-physshell','physshell']]) db.query('INSERT INTO users(id,username) VALUES(?,?)').run(id,name);
 return db;
}
test('recovery is bounded, idempotent, and uses the real queue without publishing artifacts',async()=>{
 const db=await fixture();try {
 db.exec(recovery);
 const rows = () => db.query('SELECT j.id,u.username,j.week_key,j.requested_by,j.status FROM generation_jobs j JOIN users u ON u.id=j.user_id ORDER BY u.username,j.week_key').all();
 const expected = [
  ['818ca963-0666-465d-ae1e-d930a813c5bf','karpathy','2026-W20'],
  ['b52c7c0d-1e40-438e-902d-a91d91384e63','nikolays','2026-W32'],
  ['6bfa9658-5c82-430c-90ad-2688335d2b63','nikolays','2026-W36'],
  ['5ece0481-557e-45dd-9c12-a9b12d3190a5','physshell','2026-W30'],
  ['2877a4f5-c2d7-4688-8fdc-ab5d61d6606f','steipete','2026-W14'],
  ['85a7fe4e-4e3b-4dcc-9ba4-a50e6f9ed4f2','torvalds','2026-W16'],
 ].map(([id,username,week_key])=>({id,username,week_key,requested_by:'1345402',status:'queued'}));
 expect(rows()).toEqual(expected);
 db.exec(recovery);
 expect(rows()).toEqual(expected);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:6});
 expect(db.query("SELECT COUNT(*) n FROM generation_jobs WHERE status='queued' AND requested_by='1345402'").get()).toEqual({n:6});
 expect(db.query('SELECT COUNT(*) n FROM edition_versions').get()).toEqual({n:0});
 expect(db.query('SELECT COUNT(*) n FROM sessions').get()).toEqual({n:0});
 }finally{db.close();}
});
test('recovery preserves live work and suppression and does not create missing identities',async()=>{
 const db=await fixture();try {
 db.exec("INSERT INTO profile_suppressions(username,reason) VALUES('karpathy','test suppression'); INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('existing','test-steipete','1345402','2026-W14','writing'); DELETE FROM users WHERE username='physshell';");
 db.exec(recovery);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:4});
 expect(db.query("SELECT status FROM generation_jobs WHERE id='existing'").get()).toEqual({status:'writing'});
 expect(db.query("SELECT COUNT(*) n FROM generation_jobs WHERE user_id='test-karpathy'").get()).toEqual({n:0});
 }finally{db.close();}
});
test('fresh database without the existing owner identity queues nothing',async()=>{
 const db=await fixture(false);try{db.exec(recovery);expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:0});}finally{db.close();}
});
test('eligible target users cannot queue without the fixed authorized owner identity',async()=>{
 const db=await fixture();try {
 db.exec("DELETE FROM users WHERE id='1345402'");
 db.exec(recovery);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:0});
 db.exec("INSERT INTO users(id,username) VALUES('wrong-owner','nikolays')");
 db.exec(recovery);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:0});
 }finally{db.close();}
});
test('published editions are preserved without replacement jobs',async()=>{
 const db=await fixture();try {
 db.exec("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES('previous-publication','test-steipete','1345402','2026-W14','published')");
 const before=db.query("SELECT * FROM generation_jobs WHERE id='previous-publication'").get();
 db.exec(recovery);
 expect(db.query("SELECT * FROM generation_jobs WHERE user_id='test-steipete' AND week_key='2026-W14'").all()).toEqual([before]);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:6});
 }finally{db.close();}
});
test('owner suppression prevents all recovery jobs',async()=>{
 const db=await fixture();try {
 db.exec("INSERT INTO profile_suppressions(username,reason) VALUES('nikolays','owner suppression')");
 db.exec(recovery);
 expect(db.query('SELECT COUNT(*) n FROM generation_jobs').get()).toEqual({n:0});
 }finally{db.close();}
});
