import {directedPaidRuntime} from './directed-paid-runtime.mjs';
import {createPublicPaidStore} from '../../../broker/src/v4/directed-paid-public-store.mjs';
import {createPublicPaidCoordinator} from '../../../broker/src/v4/directed-paid-public.mjs';
import {paidAssert} from '../../../broker/src/v4/directed-paid-mint.mjs';
export async function directedPublicPaidRuntime(identity,environment=process.env){
 const runtime=await directedPaidRuntime('request',environment),pool=runtime.store.pool;
 const role=(await pool.query(`SELECT c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,
 pg_has_role(current_user,c.relowner,'USAGE') AS owns,has_table_privilege(current_user,c.oid,'DELETE') AS deletes,
 has_table_privilege(current_user,c.oid,'SELECT,INSERT') AS access,
 has_column_privilege(current_user,c.oid,'review_json','UPDATE') AS changes_review
 FROM pg_class c WHERE c.oid='broker_public_paid_reviews'::regclass`)).rows[0];
 paidAssert(role?.rls===true&&role.forced===true&&role.owns===false&&role.deletes===false&&role.access===true&&role.changes_review===false,'PAID_DATABASE_ROLE_INVALID');
 const store=createPublicPaidStore(pool,identity);
 return {...runtime,store,coordinator:createPublicPaidCoordinator({...runtime,identity,store})};
}
