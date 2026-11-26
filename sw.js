'use strict';
const CACHE='jvault-shell-v30';
const scopeUrl=new URL(self.registration.scope);
const APP_BASE=scopeUrl.pathname.includes('/functions/v1/')
  ? new URL('jvault/',scopeUrl).pathname.replace(/\/$/,'')
  : new URL('./',scopeUrl).pathname.replace(/\/$/,'');
const APP_URL=new URL(APP_BASE+'/',self.location.origin).href;
const ASSET_PATHS=['','style.css','design-system.css','police-penguin.css','app.js','manifest.webmanifest','icon.svg'];
const ASSET_URLS=ASSET_PATHS.map(path=>new URL(path,APP_URL).href);
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSET_URLS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key.startsWith('jvault-shell-')&&key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(!ASSET_PATHS.some((path,index)=>url.pathname===new URL(ASSET_URLS[index]).pathname))return;
  event.respondWith(caches.match(request).then(cached=>{
    const network=fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy))}
      return response;
    }).catch(()=>null);
    return cached||network.then(response=>response||caches.match(ASSET_URLS[0]));
  }));
});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{payload={body:event.data?.text()||''}}
  const title=payload.title||'JVault reminder';
  event.waitUntil(self.registration.showNotification(title,{
    body:payload.body||'A reminder is due.',
    icon:new URL('icon.svg',APP_URL).href,
    badge:new URL('icon.svg',APP_URL).href,
    tag:payload.tag||'jvault-reminder',
    renotify:false,
    data:{url:payload.url||APP_URL}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url||APP_URL;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if('focus'in client){client.navigate(target);return client.focus()}
    }
    return self.clients.openWindow(target);
  }));
});
