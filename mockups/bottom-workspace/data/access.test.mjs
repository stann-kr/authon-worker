import test from 'node:test';
import assert from 'node:assert/strict';
import { initialData } from './fixtures.ts';
import { viewLabels } from './types.ts';
import { canOpenView, assertCapability, assertViewAccess, permissionsFor, requireGuestAction } from './access.ts';
import { requireManagedAccount, validateAccountGrant } from '../accounts/policy.ts';
import { requireWritableLink } from '../registration/access.ts';

const common=['home','roster','profile','auth','external'];
const admin=['events','artists','bookings','schedule','preparation','report','links','users','password-requests','analytics','requests','door','attendance'];
const expected={super:[...common,...admin,'venues'],admin:[...common,...admin],door:[...common,'door','attendance'],sora:[...common,'requests'],staff:[...common,'requests'],team:[...common,'door','attendance'],'register-team':common};
for(const [id,views] of Object.entries(expected)) test(`${id}: every view follows its capability set`,()=>{
 const data=initialData(),user=data.users.find(u=>u.id===id);
 for(const view of Object.keys(viewLabels)) assert.equal(canOpenView(user,view),views.includes(view),`${id}/${view}`);
});
test('revoked actor, foreign venue, and disallowed private views fail at mutation entry',()=>{
 const data=initialData();
 assert.throws(()=>assertViewAccess(data,'sora','users','faust'));
 assert.throws(()=>assertViewAccess(data,'admin','events','studio'));
 assert.throws(()=>assertViewAccess(data,'team','requests','faust'));
 data.users.find(u=>u.id==='admin').active=false;
 assert.throws(()=>assertViewAccess(data,'admin','events','faust'));
 assert.doesNotThrow(()=>assertViewAccess(data,'admin','auth',''));
 assert.doesNotThrow(()=>assertViewAccess(data,'unassigned','profile',''));
 assert.throws(()=>assertViewAccess(data,'unassigned','roster',''));
});
test('guest ownership, door capability, and tenant are rechecked for writes',()=>{
 const data=initialData();
 assert.doesNotThrow(()=>requireGuestAction(data,'sora','tonight','g4','delete'));
 assert.throws(()=>requireGuestAction(data,'sora','tonight','g2','delete'));
 assert.throws(()=>requireGuestAction(data,'sora','tonight','g1','delete'));
 assert.throws(()=>requireGuestAction(data,'sora','tonight','g4','check'));
 assert.throws(()=>requireGuestAction(data,'studio-admin','tonight','g4','check'));
 assert.doesNotThrow(()=>requireGuestAction(data,'team','tonight','g4','check'));
 data.users.find(u=>u.id==='team').doorAccess=false;
 assert.throws(()=>requireGuestAction(data,'team','tonight','g4','check'));
 assert.throws(()=>requireGuestAction(data,'team','tonight','g4','delete'));
 data.users.find(u=>u.id==='sora').doorAccess=true;
 assert.equal(permissionsFor(data.users.find(u=>u.id==='sora')).canDoor,false,'personal flag does not grant Door');
 assert.throws(()=>assertCapability(data,'door','admin','faust'));
});
test('account grants reject forged elevation and invalid shared/personal combinations',()=>{
 const data=initialData(),actor=data.users.find(u=>u.id==='admin'),superAdmin=data.users.find(u=>u.id==='super');
 for(const [role,kind,door] of [['super_admin','personal',false],['venue_admin','personal',false],['dj','shared',false],['staff','personal',true],['other','personal',false]])
  assert.throws(()=>validateAccountGrant(actor,role,kind,door));
 assert.throws(()=>validateAccountGrant(superAdmin,'super_admin','personal',false));
 assert.throws(()=>validateAccountGrant(data.users.find(u=>u.id==='staff'),'dj','personal',false));
 assert.doesNotThrow(()=>validateAccountGrant(superAdmin,'venue_admin','personal',false));
 assert.doesNotThrow(()=>validateAccountGrant(actor,'staff','shared',true));
 assert.throws(()=>requireManagedAccount(data,'admin','admin','faust'));
 assert.throws(()=>requireManagedAccount(data,'admin','super','faust'));
 assert.throws(()=>requireManagedAccount(data,'admin','studio-admin','faust'));
 assert.doesNotThrow(()=>requireManagedAccount(data,'admin','sora','faust'));
 data.users.find(u=>u.id==='sora').role='venue_admin';
 assert.throws(()=>requireManagedAccount(data,'admin','sora','faust'));
});
test('external bearer permissions revalidate link kind, expiry, venue and event state',()=>{
 const data=initialData(),link=data.links.find(l=>l.kind==='contributor');
 assert.doesNotThrow(()=>requireWritableLink(data,link.id,'contributor','normal'));
 assert.throws(()=>requireWritableLink(data,link.id,'self_rsvp','normal'));
 for(const scenario of ['link-inactive','link-expired','scope-closed','storage-denied','unknown-result'])
  assert.throws(()=>requireWritableLink(data,link.id,'contributor',scenario));
 for(const change of [d=>{d.links.find(l=>l.id===link.id).active=false;},d=>{d.links.find(l=>l.id===link.id).expiresAt='2026-01-01T00:00:00Z';},d=>{d.venues[0].active=false;},d=>{d.events.find(e=>e.id===link.eventId).state='closed';},d=>{d.attendance[link.eventId]={finalized:true};}]) {
  const copy=structuredClone(data);change(copy);
  assert.throws(()=>requireWritableLink(copy,link.id,'contributor','normal'));
 }
});
