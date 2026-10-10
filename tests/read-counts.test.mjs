import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
let db;
const visible = randomUUID(), hidden = randomUUID();
const h = n => n.toString(16).padStart(64,'0');
const migration = new URL('../supabase/migrations/202610090001_read_counts.sql',import.meta.url);
let snapshot, likes, reports;
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 await db.exec(await readFile(new URL('../supabase/migrations/202610080001_initial.sql',import.meta.url),'utf8'));
 await db.query("insert into public.posts(id,body,actor_hash,request_id,likes_count) values($1,'今日は少し悲しい。誰かに聞いてほしい。',$2,$3,1)",[visible,h(1),randomUUID()]);
 await db.query("insert into public.posts(id,body,actor_hash,request_id,status,moderated_at) values($1,'既存の非公開投稿',$2,$3,'hidden',now())",[hidden,h(2),randomUUID()]);
 await db.query('insert into public.likes(post_id,actor_hash) values($1,$2)',[visible,h(3)]);
 await db.query("insert into public.reports(post_id,actor_hash,reason) values($1,$2,'other')",[visible,h(4)]);
 snapshot=(await db.query('select * from public.posts order by id')).rows;
 likes=(await db.query('select * from public.likes')).rows;
 reports=(await db.query('select * from public.reports')).rows;
 await db.exec(await readFile(migration,'utf8'));
});
after(async()=>await db?.close());
const view = async(actor,id=visible) => (await db.query("select public.good_things_write('view',$1,$2,null,null,$3,null) result",[h(actor),h(100),id])).rows[0].result;
test('移行：既存の本文・日時・状態・いいね・通報を保持し、既読数だけ0で追加',async()=>{
 const migrated=(await db.query('select * from public.posts order by id')).rows;
 assert.deepEqual(migrated.map(({views_count,...row})=>row),snapshot);
 assert.ok(migrated.every(x=>x.views_count===0));
 assert.deepEqual((await db.query('select * from public.likes')).rows,likes);
 assert.deepEqual((await db.query('select * from public.reports')).rows,reports);
});
test('既読：一覧取得では増えず、同じブラウザーは1件、別IDは原子的に加算',async()=>{
 await db.query('select public.good_things_list($1)',[h(100)]);
 assert.equal((await db.query('select views_count from public.posts where id=$1',[visible])).rows[0].views_count,0);
 assert.equal((await view(10)).views_count,1);
 const repeated=await view(10); assert.equal(repeated.views_count,1);assert.equal(repeated.alreadyViewed,true);
 await Promise.all([view(11),view(12),view(13)]);
 const stored=(await db.query('select views_count,(select count(*)::int from public.post_views where post_id=$1) as receipts from public.posts where id=$1',[visible])).rows[0];
 assert.deepEqual(stored,{views_count:4,receipts:4});
 const listed=(await db.query('select public.good_things_list($1) result',[h(100)])).rows[0].result;
 assert.equal(listed[0].views_count,4);assert.equal(listed[0].likes_count,1);
});
test('既読：サーバーで連打制限、不正ID・非公開投稿の記録を拒否',async()=>{
 for(let i=0;i<20;i++) await view(20);
 await assert.rejects(view(20),/rate_limited/);
 await assert.rejects(view(21,hidden),/post_unavailable/);
 await assert.rejects(view(21,randomUUID()),/post_unavailable/);
 assert.equal((await db.query('select views_count from public.posts where id=$1',[hidden])).rows[0].views_count,0);
});
test('管理：一般ロールは既読テーブル・削除RPCを利用できず、所有者だけ履歴付き削除',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   if(role!=='service_role') await assert.rejects(db.query('select * from public.post_views'),e=>e.code==='42501');
   await assert.rejects(db.query("select public.good_things_delete($1,'test')",[hidden]),e=>e.code==='42501');
  }finally{await db.exec('reset role');}
 }
 await db.query("select public.good_things_delete($1,'ローカル試験用')",[visible]);
 assert.equal((await db.query('select count(*)::int n from public.posts where id=$1',[visible])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.post_views')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from public.likes')).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from public.moderation_log where new_status='deleted'")).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from public.posts where id=$1',[hidden])).rows[0].n,1);
});
