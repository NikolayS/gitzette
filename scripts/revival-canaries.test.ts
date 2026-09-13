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
 db.exec(recovery);db.exec(recovery);
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
