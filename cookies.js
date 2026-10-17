(function(){
  var KEY='cookie-consent';
  function get(){try{return localStorage.getItem(KEY);}catch(e){return null;}}
  function set(v){try{localStorage.setItem(KEY,v);}catch(e){}}
  var root=(document.currentScript&&document.currentScript.src||'').replace(/cookies\.js.*$/,'');
  function loadMaps(){
    document.querySelectorAll('iframe[data-src]').forEach(function(f){
      f.src=f.getAttribute('data-src');f.removeAttribute('data-src');f.style.display='block';
    });
    document.querySelectorAll('.map-placeholder').forEach(function(p){p.style.display='none';});
  }
  function placeholder(){
    document.querySelectorAll('iframe[data-src]').forEach(function(f){
      f.style.display='none';
      if(f.parentNode.querySelector('.map-placeholder'))return;
      var d=document.createElement('div');d.className='map-placeholder';
      d.innerHTML='<p>Para ver el mapa necesitamos tu permiso para cargar contenido de Google Maps.</p><button type="button" class="btn btn-teal" data-load-map>Mostrar mapa</button>';
      f.parentNode.insertBefore(d,f);
      d.querySelector('button').addEventListener('click',function(){set('accepted');loadMaps();});
    });
  }
  function banner(){
    var b=document.createElement('div');b.className='cookie-banner';b.setAttribute('role','dialog');b.setAttribute('aria-label','Aviso de cookies');
    b.innerHTML='<p>Usamos Google Maps y Google Fonts, servicios de terceros que pueden instalar cookies. Puedes aceptarlos o rechazarlos. Más información en la <a href="'+root+'cookies.html">política de cookies</a>.</p><div class="cookie-actions"><button type="button" class="btn cookie-reject">Rechazar</button><button type="button" class="btn btn-teal cookie-accept">Aceptar</button></div>';
    document.body.appendChild(b);
    b.querySelector('.cookie-accept').onclick=function(){set('accepted');b.remove();loadMaps();};
    b.querySelector('.cookie-reject').onclick=function(){set('rejected');b.remove();placeholder();};
  }
  document.addEventListener('DOMContentLoaded',function(){
    var v=get();
    if(v==='accepted')loadMaps();
    else{placeholder();if(!v)banner();}
    document.querySelectorAll('[data-cookie-settings]').forEach(function(a){
      a.addEventListener('click',function(e){e.preventDefault();set('');try{localStorage.removeItem(KEY);}catch(x){}
        var old=document.querySelector('.cookie-banner');if(old)old.remove();banner();});
    });
  });
})();
