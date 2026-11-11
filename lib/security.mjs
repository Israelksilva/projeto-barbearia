import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const secret = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  if (!stored) { await scrypt(password,'dummy-account-salt',64,{N:32768,r:8,p:1,maxmem:64*1024*1024}); return false; }
  const [salt,key] = stored.split(':');
  const actual = await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(Buffer.from(key,'hex'),actual);
}
export function makeLimiter() {
  const buckets = new Map();
  return (key, limit=20, period=15*60*1000) => {
    const now=Date.now(); if (buckets.size>10000) for(const [k,v] of buckets) if(v.expires<now) buckets.delete(k);
    let value=buckets.get(key); if(!value||value.expires<now){value={count:0,expires:now+period};buckets.set(key,value);}
    value.count++; return value.count<=limit;
  };
}
