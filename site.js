/* ── Diana Shirinova site — shared JS (cart, lightbox, Shopify Storefront API) ──
   Loaded on every page via <script src="assets/site.js" defer></script>.
   Each page's own trailing inline script calls initPaintings(cb) with whatever
   it needs built (see comment above that function below). ── */

/* Mobile menu — burger toggle opens/closes the off-canvas nav drawer */
(function(){
  var toggle = document.getElementById('mobile-menu-toggle');
  var closeBtn = document.getElementById('mobile-menu-close');
  var backdrop = document.getElementById('mobile-menu-backdrop');
  var menu = document.getElementById('mobile-menu');
  if (!toggle || !menu) return;
  function open(){ menu.classList.add('open'); backdrop.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close(){ menu.classList.remove('open'); backdrop.classList.remove('open'); document.body.style.overflow = ''; }
  toggle.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  menu.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', close); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
})();

/* Announcement banner — auto-hides itself once the market date has passed (HST) */
(function(){
  if (new Date() <= new Date('2026-08-09T06:00:00-10:00')) {
    document.body.classList.add('has-announce');
  } else {
    var a = document.getElementById('announce');
    if (a) a.remove();
  }
})();

/* ── Artworks live in paintings.json — managed via the admin panel ── */
var PAINTINGS = [], PALETTES = [], FEATURED = [], HERO_IDX = [];
var GALLERY_FILTER = null; /* set by buildGallery(predicate); lightbox nav (prev/next) respects it too */

function deriveCollections(){
  PALETTES = PAINTINGS.map(function(p){ return p.palette || []; });
  FEATURED = PAINTINGS
    .map(function(p, i){ return { p: p, i: i }; })
    .filter(function(x){ return x.p.featured; })
    .sort(function(a, b){ return a.p.featured - b.p.featured; })
    .map(function(x){ return { i: x.i, status: x.p.status || 'Private Collection' }; });
  HERO_IDX = PAINTINGS
    .map(function(p, i){ return { p: p, i: i }; })
    .filter(function(x){ return x.p.hero; })
    .sort(function(a, b){ return a.p.hero - b.p.hero; })
    .map(function(x){ return x.i; });
  if (!HERO_IDX.length) HERO_IDX = FEATURED.slice(0, 3).map(function(f){ return f.i; });
}


function makePalette(idx, cls){
  var strip = document.createElement('div');
  strip.className = 'palette-strip' + (cls ? ' ' + cls : '');
  strip.setAttribute('aria-label', 'Hand-mixed palette of ' + PAINTINGS[idx].title);
  (PALETTES[idx] || []).forEach(function(c){
    var d = document.createElement('span');
    d.className = 'daub';
    d.style.background = c;
    strip.appendChild(d);
  });
  return strip;
}

/* ── Config ── */
/* Print purchases: fill in once after creating a Storefront API token
   (Shopify Admin → Sales channels → Headless → Create storefront → Manage
   Storefront API → copy the Public access token). SHOP_DOMAIN is the
   *.myshopify.com domain, not the custom domain. Until both are filled in,
   print purchases simply don't render — nothing breaks. No external Shopify
   script is loaded — this talks to the Storefront GraphQL API directly. */
var SHOP_DOMAIN      = 'dianashirinova.myshopify.com';
var STOREFRONT_TOKEN = '92704dcda310a6bb51e98406105f014f';
var INSTAGRAM = 'https://www.instagram.com/DianaShirinova_art';
var EMAIL     = 'hello@dianashirinova.com';

var SHOPIFY_API_VERSION = '2025-01';
function shopifyGraphQL(query, variables){
  return fetch('https://' + SHOP_DOMAIN + '/api/' + SHOPIFY_API_VERSION + '/graphql.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN
    },
    body: JSON.stringify({ query: query, variables: variables || {} })
  }).then(function(r){ return r.json(); });
}

var PRODUCT_QUERY =
  'query($handle: String!){ product(handle: $handle){ id title availableForSale ' +
  'variants(first: 12){ edges{ node{ id availableForSale price{ amount currencyCode } ' +
  'selectedOptions{ name value } } } } } }';

/* ── Cart: one persistent Shopify cart per visitor, so multiple prints
   accumulate before a single checkout, instead of each "Buy" starting a
   fresh one-item checkout. Cart id is kept in localStorage. ── */
var CART_FIELDS =
  'id checkoutUrl totalQuantity ' +
  'lines(first: 50){ edges{ node{ id quantity merchandise{ ... on ProductVariant{ ' +
  'id title image{ url } price{ amount currencyCode } ' +
  'product{ title handle } selectedOptions{ name value } } } } } } ' +
  'cost{ subtotalAmount{ amount currencyCode } }';

var CART_CREATE_MUTATION =
  'mutation($lines: [CartLineInput!]){ cartCreate(input:{ lines: $lines }){ ' +
  'cart{ ' + CART_FIELDS + ' } userErrors{ message } } }';

var CART_QUERY =
  'query($id: ID!){ cart(id: $id){ ' + CART_FIELDS + ' } }';

var CART_LINES_ADD_MUTATION =
  'mutation($cartId: ID!, $lines: [CartLineInput!]!){ cartLinesAdd(cartId: $cartId, lines: $lines){ ' +
  'cart{ ' + CART_FIELDS + ' } userErrors{ message } } }';

var CART_LINES_UPDATE_MUTATION =
  'mutation($cartId: ID!, $lines: [CartLineUpdateInput!]!){ cartLinesUpdate(cartId: $cartId, lines: $lines){ ' +
  'cart{ ' + CART_FIELDS + ' } userErrors{ message } } }';

var CART_LINES_REMOVE_MUTATION =
  'mutation($cartId: ID!, $lineIds: [ID!]!){ cartLinesRemove(cartId: $cartId, lineIds: $lineIds){ ' +
  'cart{ ' + CART_FIELDS + ' } userErrors{ message } } }';

var CART_ID_KEY = 'dianaShirinovaCartId';
var CURRENT_CART = null;

function cartGetId(){ try{ return localStorage.getItem(CART_ID_KEY); }catch(e){ return null; } }
function cartSetId(id){ try{ localStorage.setItem(CART_ID_KEY, id); }catch(e){} }
function cartClearId(){ try{ localStorage.removeItem(CART_ID_KEY); }catch(e){} }

function fmtMoney(amount, currency){
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount);
}

function updateCartBadge(){
  var badge = document.getElementById('cart-badge');
  if (!badge) return;
  var qty = (CURRENT_CART && CURRENT_CART.totalQuantity) || 0;
  badge.textContent = qty;
  badge.style.display = qty > 0 ? 'flex' : 'none';
}

function renderCartDrawer(){
  var body = document.getElementById('cart-drawer-body');
  var footer = document.getElementById('cart-drawer-footer');
  if (!body || !footer) return;
  body.innerHTML = '';
  footer.innerHTML = '';
  var edges = (CURRENT_CART && CURRENT_CART.lines && CURRENT_CART.lines.edges) || [];
  if (!edges.length){
    body.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    return;
  }
  edges.forEach(function(edge){
    var line = edge.node;
    var v = line.merchandise;
    var row = document.createElement('div');
    row.className = 'cart-line';

    var img = document.createElement('img');
    img.className = 'cart-line-img';
    img.src = (v.image && v.image.url) || '';
    img.alt = v.product.title;
    img.loading = 'lazy';

    var info = document.createElement('div');
    info.className = 'cart-line-info';

    var title = document.createElement('p');
    title.className = 'cart-line-title';
    title.textContent = v.product.title;

    var variant = document.createElement('p');
    variant.className = 'cart-line-variant';
    variant.textContent = (v.selectedOptions || []).map(function(o){ return o.value; }).join(' / ');

    var price = document.createElement('p');
    price.className = 'cart-line-price';
    price.textContent = fmtMoney(v.price.amount, v.price.currencyCode);

    var qtyRow = document.createElement('div');
    qtyRow.className = 'cart-line-qty';
    var minus = document.createElement('button');
    minus.type = 'button'; minus.textContent = '\u2212'; minus.setAttribute('aria-label', 'Decrease quantity');
    minus.addEventListener('click', function(){ cartUpdateLine(line.id, line.quantity - 1); });
    var qtyVal = document.createElement('span');
    qtyVal.textContent = line.quantity;
    var plus = document.createElement('button');
    plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Increase quantity');
    plus.addEventListener('click', function(){ cartUpdateLine(line.id, line.quantity + 1); });
    qtyRow.appendChild(minus); qtyRow.appendChild(qtyVal); qtyRow.appendChild(plus);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cart-line-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function(){ cartRemoveLine(line.id); });

    info.appendChild(title);
    if (variant.textContent) info.appendChild(variant);
    info.appendChild(price);
    info.appendChild(qtyRow);
    info.appendChild(remove);
    row.appendChild(img);
    row.appendChild(info);
    body.appendChild(row);
  });

  var subtotal = CURRENT_CART.cost && CURRENT_CART.cost.subtotalAmount;
  if (subtotal){
    var sub = document.createElement('p');
    sub.className = 'cart-subtotal';
    sub.innerHTML = '<span>Subtotal</span><span>' + fmtMoney(subtotal.amount, subtotal.currencyCode) + '</span>';
    footer.appendChild(sub);
  }
  var checkoutBtn = document.createElement('a');
  checkoutBtn.className = 'btn-line btn-line--rose cart-checkout-btn';
  checkoutBtn.textContent = 'Checkout \u2192';
  checkoutBtn.href = CURRENT_CART.checkoutUrl || '#';
  footer.appendChild(checkoutBtn);
  var note = document.createElement('p');
  note.className = 'cart-note';
  note.textContent = 'Shipping and taxes calculated at checkout.';
  footer.appendChild(note);
}

function renderCart(cart){
  CURRENT_CART = cart;
  updateCartBadge();
  renderCartDrawer();
}

function cartAdd(variantId, qty){
  var id = cartGetId();
  var request = id
    ? shopifyGraphQL(CART_LINES_ADD_MUTATION, { cartId: id, lines: [{ merchandiseId: variantId, quantity: qty }] })
        .then(function(res){ return res && res.data && res.data.cartLinesAdd; })
    : Promise.resolve(null);

  return request.then(function(payload){
    if (payload && payload.cart) return payload;
    /* No existing cart, or it was invalid/expired — start a fresh one */
    return shopifyGraphQL(CART_CREATE_MUTATION, { lines: [{ merchandiseId: variantId, quantity: qty }] })
      .then(function(res){ return res && res.data && res.data.cartCreate; });
  }).then(function(payload){
    if (payload && payload.cart){
      cartSetId(payload.cart.id);
      renderCart(payload.cart);
      return payload.cart;
    }
    var msg = (payload && payload.userErrors && payload.userErrors[0] && payload.userErrors[0].message) || 'Could not add to cart.';
    throw new Error(msg);
  });
}

function cartUpdateLine(lineId, qty){
  var id = cartGetId();
  if (!id) return;
  if (qty < 1) return cartRemoveLine(lineId);
  shopifyGraphQL(CART_LINES_UPDATE_MUTATION, { cartId: id, lines: [{ id: lineId, quantity: qty }] })
    .then(function(res){
      var payload = res && res.data && res.data.cartLinesUpdate;
      if (payload && payload.cart) renderCart(payload.cart);
    });
}

function cartRemoveLine(lineId){
  var id = cartGetId();
  if (!id) return;
  shopifyGraphQL(CART_LINES_REMOVE_MUTATION, { cartId: id, lineIds: [lineId] })
    .then(function(res){
      var payload = res && res.data && res.data.cartLinesRemove;
      if (payload && payload.cart) renderCart(payload.cart);
    });
}

function cartInit(){
  var id = cartGetId();
  if (!id){ updateCartBadge(); return; }
  shopifyGraphQL(CART_QUERY, { id: id }).then(function(res){
    var cart = res && res.data && res.data.cart;
    if (cart){ renderCart(cart); } else { cartClearId(); updateCartBadge(); }
  }).catch(function(){ updateCartBadge(); });
}

function openCartDrawer(){
  var d = document.getElementById('cart-drawer'), b = document.getElementById('cart-backdrop');
  if (d) d.classList.add('open');
  if (b) b.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCartDrawer(){
  var d = document.getElementById('cart-drawer'), b = document.getElementById('cart-backdrop');
  if (d) d.classList.remove('open');
  if (b) b.classList.remove('open');
  document.body.style.overflow = '';
}

(function(){
  var toggle = document.getElementById('cart-toggle');
  var closeBtn = document.getElementById('cart-drawer-close');
  var backdrop = document.getElementById('cart-backdrop');
  if (toggle) toggle.addEventListener('click', openCartDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeCartDrawer);
  if (backdrop) backdrop.addEventListener('click', closeCartDrawer);
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeCartDrawer();
  });
  cartInit();
})();

function renderBuyButton(handle){
  lbBuy.innerHTML = '';
  if (!handle || !SHOP_DOMAIN || !STOREFRONT_TOKEN) return;
  lbBuy.innerHTML = '<p class="buy-status">Loading&hellip;</p>';
  shopifyGraphQL(PRODUCT_QUERY, { handle: handle }).then(function(res){
    var product = res && res.data && res.data.product;
    if (!product || !product.availableForSale){ lbBuy.innerHTML = ''; return; }
    buildBuyPanel(product);
  }).catch(function(err){
    console.error('Shopify product fetch failed:', handle, err);
    lbBuy.innerHTML = '';
  });
}

function buildBuyPanel(product){
  var variants = product.variants.edges.map(function(e){ return e.node; }).filter(function(v){ return v.availableForSale; });
  if (!variants.length){ lbBuy.innerHTML = ''; return; }
  var picked = variants[0];

  var wrap = document.createElement('div');
  wrap.className = 'buy-panel';

  var price = document.createElement('div');
  price.className = 'buy-price';
  wrap.appendChild(price);

  var sizes = document.createElement('div');
  sizes.className = 'buy-sizes';
  wrap.appendChild(sizes);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-line btn-line--rose buy-cta';
  btn.textContent = 'Add to Cart';
  wrap.appendChild(btn);

  var status = document.createElement('p');
  status.className = 'buy-status';
  wrap.appendChild(status);

  function fmt(v){
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: v.price.currencyCode }).format(v.price.amount);
  }
  function select(v){
    picked = v;
    price.textContent = fmt(v);
    sizes.querySelectorAll('.buy-size').forEach(function(el){
      el.classList.toggle('active', el.dataset.id === v.id);
    });
  }
  variants.forEach(function(v){
    var label = v.selectedOptions.map(function(o){ return o.value; }).join(' / ') || 'Print';
    var opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'buy-size';
    opt.dataset.id = v.id;
    opt.textContent = label;
    opt.addEventListener('click', function(){ select(v); });
    sizes.appendChild(opt);
  });
  select(variants[0]);

  btn.addEventListener('click', function(){
    btn.disabled = true;
    status.textContent = 'Adding to cart\u2026';
    cartAdd(picked.id, 1)
      .then(function(){
        status.textContent = 'Added to cart \u2713';
        btn.disabled = false;
        openCartDrawer();
      })
      .catch(function(err){
        console.error('Add to cart failed:', err);
        status.textContent = err.message || 'Could not add to cart \u2014 please try again.';
        btn.disabled = false;
      });
  });

  lbBuy.innerHTML = '';
  lbBuy.appendChild(wrap);
}

var copyYearEl = document.getElementById('copyYear');
if (copyYearEl) copyYearEl.textContent = new Date().getFullYear();

/* ── After the market date, remove the market section and its nav link ── */
if (new Date() > new Date('2026-08-09T06:00:00-10:00')) {
  ['market', 'navMarket'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.remove();
  });
}

/* ── Lightbox (declared first so featured + gallery can call it) ── */
var currentIdx = 0;
var lb = document.getElementById('lightbox');
var lbImg = document.getElementById('lightbox-img');
var lbTitle = document.getElementById('lightbox-title');
var lbDesc = document.getElementById('lightbox-desc');
var lbPal = document.getElementById('lightbox-palette');
var lbThumbs = document.getElementById('lightbox-thumbs');
var lbBuy = document.getElementById('lightbox-buy');
var lbInquire = document.getElementById('lightbox-inquire');
var lbClose = document.getElementById('lightbox-close');
var lastFocused = null;

function setLbPalette(idx){
  lbPal.innerHTML = '';
  (PALETTES[idx] || []).forEach(function(c){
    var d = document.createElement('span');
    d.className = 'daub';
    d.style.background = c;
    lbPal.appendChild(d);
  });
}

function getPhotos(idx){
  var p = PAINTINGS[idx];
  return (p.photos && p.photos.length) ? p.photos : [{ src: p.src, label: '' }];
}

function showPhoto(idx, phIdx){
  var photos = getPhotos(idx);
  var ph = photos[phIdx] || photos[0];
  lbImg.src = ph.src;
  lbImg.alt = PAINTINGS[idx].title + (ph.label ? ' — ' + ph.label : '');
  var nodes = lbThumbs.querySelectorAll('.lb-thumb');
  for (var i = 0; i < nodes.length; i++){
    nodes[i].classList.toggle('active', i === phIdx);
  }
}

function updateLightboxPanel(idx){
  var p = PAINTINGS[idx];
  lbTitle.textContent = p.title;
  lbDesc.textContent = p.description || '';
  renderBuyButton(p.shopifyHandle);
  lbInquire.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Original Inquiry: ' + p.title) +
    '&body=' + encodeURIComponent('Aloha Diana, I\'d love to know more about the original of "' + p.title + '".');
}

function buildThumbs(idx){
  lbThumbs.innerHTML = '';
  var photos = getPhotos(idx);
  if (photos.length < 2){
    lb.classList.remove('has-thumbs');
    return;
  }
  lb.classList.add('has-thumbs');
  photos.forEach(function(ph, i){
    var t = document.createElement('img');
    t.className = 'lb-thumb';
    t.src = ph.src;
    t.alt = ph.label || PAINTINGS[idx].title;
    t.loading = 'lazy';
    t.addEventListener('click', function(e){
      e.stopPropagation();
      showPhoto(idx, i);
    });
    lbThumbs.appendChild(t);
  });
}

function openLightbox(idx){
  currentIdx = idx;
  lastFocused = document.activeElement;
  buildThumbs(idx);
  showPhoto(idx, 0);
  setLbPalette(idx);
  updateLightboxPanel(idx);
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  lbClose.focus();
}
function closeLightbox(){
  lb.classList.remove('open');
  document.body.style.overflow = '';
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
}
function stepImg(dir){
  var n = PAINTINGS.length, idx = currentIdx;
  for (var k = 0; k < n; k++){
    idx = (idx + dir + n) % n;
    if (!GALLERY_FILTER || GALLERY_FILTER(PAINTINGS[idx])) { currentIdx = idx; break; }
  }
  buildThumbs(currentIdx);
  showPhoto(currentIdx, 0);
  setLbPalette(currentIdx);
  updateLightboxPanel(currentIdx);
}

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-prev').addEventListener('click', function(){ stepImg(-1); });
document.getElementById('lightbox-next').addEventListener('click', function(){ stepImg(1); });
lb.addEventListener('click', function(e){ if(e.target === lb) closeLightbox(); });
document.addEventListener('keydown', function(e){
  if(!lb.classList.contains('open')) return;
  if(e.key === 'Escape') closeLightbox();
  if(e.key === 'ArrowRight') stepImg(1);
  if(e.key === 'ArrowLeft') stepImg(-1);
});

/* ── Hero floating works ── */
function buildHeroFloats(){
  var heroFloats = document.getElementById('heroFloats');
  if (!heroFloats) return;
  heroFloats.innerHTML = '';
  HERO_IDX.forEach(function(idx){
    var img = document.createElement('img');
    img.className = 'float-img';
    img.src = PAINTINGS[idx].src;
    img.alt = PAINTINGS[idx].title;
    img.width = PAINTINGS[idx].w;
    img.height = PAINTINGS[idx].h;
    heroFloats.appendChild(img);
  });
}

/* ── Process photo: real studio photograph (studio.jpg in repo root). ──
   Drop a genuine studio shot — palette, brushes, hands mixing colour, or a
   canvas in progress — next to index.html as "studio.jpg". Until it exists,
   a colour-led painting stands in so the layout never breaks. */
function initProcessPhoto(){
  var p = document.getElementById('processPhoto');
  if(!p || !PAINTINGS.length) return;
  var fb = PAINTINGS[Math.min(20, PAINTINGS.length - 1)];
  p.onerror = function(){
    p.onerror = null;
    p.src = fb.src;
    p.alt = 'Detail of a hand-mixed palette';
  };
  p.alt = 'Diana Shirinova mixing colours in her Honolulu studio';
  p.src = 'images/studio/studio.jpg';
}

/* ── Featured Collection ── */
function buildFeatured(){
  var grid = document.getElementById('featuredGrid');
  if(!grid) return;
  grid.innerHTML = '';
  FEATURED.forEach(function(f){
    var p = PAINTINGS[f.i];
    var statusClass = 'pill--' + f.status.toLowerCase().split(' ')[0];

    var card = document.createElement('article');
    card.className = 'feat-card';

    var fig = document.createElement('div');
    fig.className = 'feat-figure';
    fig.setAttribute('role', 'button');
    fig.setAttribute('tabindex', '0');
    fig.setAttribute('aria-label', 'View artwork: ' + p.title);
    fig.addEventListener('click', function(){ openLightbox(f.i); });
    fig.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openLightbox(f.i); }
    });

    var fimg = document.createElement('img');
    fimg.src = p.src; fimg.alt = p.title; fimg.loading = 'lazy'; fimg.decoding = 'async';
    fimg.width = p.w; fimg.height = p.h;

    var badge = document.createElement('span');
    badge.className = 'pill ' + statusClass + ' feat-status';
    badge.textContent = f.status;

    fig.appendChild(fimg);
    fig.appendChild(badge);

    var body = document.createElement('div');
    body.className = 'feat-body';
    var h = document.createElement('h3');
    h.className = 'feat-title';
    h.textContent = p.title;

    var actions = document.createElement('div');
    actions.className = 'feat-actions';

    var view = document.createElement('button');
    view.className = 'feat-link';
    view.type = 'button';
    view.textContent = 'View Artwork \u2192';
    view.addEventListener('click', function(){ openLightbox(f.i); });

    var prints = null;
    if (p.shopifyHandle){
      prints = document.createElement('button');
      prints.className = 'feat-link feat-link--prints';
      prints.type = 'button';
      prints.textContent = 'Fine Art Prints \u2192';
      prints.addEventListener('click', function(){ openLightbox(f.i); });
    }

    actions.appendChild(view);
    if (prints) actions.appendChild(prints);
    body.appendChild(h);
    body.appendChild(makePalette(f.i, 'feat-palette'));
    body.appendChild(actions);
    card.appendChild(fig);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

/* ── Gallery (masonry) ── */
function buildGallery(predicate, opts){
  opts = opts || {};
  GALLERY_FILTER = predicate || null;
  var grid = document.getElementById('galleryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  PAINTINGS.forEach(function(p, i){
    if (GALLERY_FILTER && !GALLERY_FILTER(p)) return;
    var card = document.createElement('div');
    card.className = 'gallery-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', 'View artwork: ' + p.title);

    var img = document.createElement('img');
    img.src = p.src;
    img.alt = p.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = p.w;
    img.height = p.h;

    var overlay = document.createElement('div');
    overlay.className = 'card-overlay';

    var meta = document.createElement('div');
    meta.innerHTML = '<div class="card-title">' + p.title +
      '</div><div class="card-num">No. ' + String(i + 1).padStart(2, '0') + '</div>';
    meta.appendChild(makePalette(i, 'card-palette'));

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var view = document.createElement('button');
    view.className = 'card-act card-act--view';
    view.type = 'button';
    view.textContent = 'View Artwork';
    view.addEventListener('click', function(e){ e.stopPropagation(); openLightbox(i); });

    var prints = null;
    if (p.shopifyHandle && !opts.hidePrintAction){
      prints = document.createElement('button');
      prints.className = 'card-act card-act--prints';
      prints.type = 'button';
      prints.textContent = 'Fine Art Prints';
      prints.addEventListener('click', function(e){ e.stopPropagation(); openLightbox(i); });
    }

    actions.appendChild(view);
    if (prints) actions.appendChild(prints);
    overlay.appendChild(meta);
    overlay.appendChild(actions);
    card.appendChild(img);
    card.appendChild(overlay);

    if (opts.showStatus){
      var statusText = p.status || 'Private Collection';
      var badge = document.createElement('span');
      badge.className = 'pill pill--' + statusText.toLowerCase().split(' ')[0] + ' feat-status';
      badge.textContent = statusText;
      card.appendChild(badge);
    }

    card.addEventListener('click', function(){ openLightbox(i); });
    card.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openLightbox(i); }
    });
    grid.appendChild(card);
  });
}

/* ── Load the collection, then let the current page decide what to build.
   Call from each page's own small inline script, e.g.:
     initPaintings(function(){ buildFeatured(); buildHeroFloats(); });          // index.html
     initPaintings(function(){ buildGallery(function(p){ return !!p.shopifyHandle; }); });  // prints.html
     initPaintings(function(){ buildGallery(null, { showStatus:true, hidePrintAction:true }); }); // originals.html
   ── */
function initPaintings(onReady){
  deriveCollections();
  if (window.__PREVIEW_DATA){        /* preview mode: data injected by the admin panel */
    PAINTINGS = window.__PREVIEW_DATA.paintings || [];
    deriveCollections();
    onReady();
    return;
  }
  fetch('paintings.json?v=' + Date.now(), { cache: 'no-store' })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data){
      PAINTINGS = (data && data.paintings) || [];
      deriveCollections();
      onReady();
    })
    .catch(function(err){
      console.error('Could not load paintings.json:', err);
      var g = document.getElementById('galleryGrid');
      if (g) g.innerHTML = '<p style="color:var(--muted);font-size:.95rem">' +
        'The collection could not be loaded &mdash; please refresh the page.</p>';
    });
}

/* ── Commission inquiry (email) ── */
(function(){
  function openCommission(){
    var s = encodeURIComponent('Commission Inquiry');
    var b = encodeURIComponent(
      'Hello Diana,\n\nI would like to inquire about commissioning an original painting.' +
      '\n\nPlease let me know your availability.\n\nThank you!');
    window.location.href = 'mailto:' + EMAIL + '?subject=' + s + '&body=' + b;
  }
  document.querySelectorAll('.js-commission').forEach(function(btn){
    btn.addEventListener('click', openCommission);
  });
})();
/* ── Pacific light: the page background drifts from dawn to dusk as you scroll ── */
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  /* [progress, --bg rgb, --surface rgb]: dawn → midday → golden hour → dusk */
  var stops = [
    [0.00, [15,21,38], [25,33,52]],
    [0.40, [10,27,29], [16,41,43]],
    [0.62, [32,22,10], [48,33,16]],
    [0.88, [38,16,26], [54,24,38]],
    [1.00, [38,16,26], [54,24,38]]
  ];
  var root = document.documentElement, ticking = false;
  var glow = document.getElementById('sunGlow');
  function mix(a, b, t){
    return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*t) + ',' +
                    Math.round(a[1]+(b[1]-a[1])*t) + ',' +
                    Math.round(a[2]+(b[2]-a[2])*t) + ')';
  }
  function setGlow(p){
    if (!glow) return;
    /* the sun rises, peaks near midday, then reddens and sets */
    var arc = Math.sin(Math.PI * Math.min(Math.max((p - 0.04) / 0.9, 0), 1));
    var warm = Math.min(Math.max((p - 0.55) / 0.35, 0), 1);
    var r = 255, g = Math.round(200 - 65 * warm), b2 = Math.round(130 - 15 * warm);
    var a = (0.26 * arc).toFixed(3);
    glow.style.opacity = 1;
    glow.style.background = 'radial-gradient(ellipse 95% 60% at 50% 16%, rgba(' +
      r + ',' + g + ',' + b2 + ',' + a + '), rgba(' +
      r + ',' + g + ',' + b2 + ',0) 68%)';
  }
  function update(){
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    setGlow(p);
    for (var i = 1; i < stops.length; i++){
      if (p <= stops[i][0]){
        var t = (p - stops[i-1][0]) / (stops[i][0] - stops[i-1][0]);
        root.style.setProperty('--bg', mix(stops[i-1][1], stops[i][1], t));
        root.style.setProperty('--surface', mix(stops[i-1][2], stops[i][2], t));
        return;
      }
    }
  }
  window.addEventListener('scroll', function(){
    if (!ticking){ ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();

/* ── Brush trail: the cursor leaves fading daubs of Diana's pigments in the gallery ── */
(function(){
  if (!window.matchMedia('(pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var zone = document.getElementById('gallery');
  if (!zone) return;
  var PIGMENTS = ['#627D86','#BF8871','#E9DCC2','#AC4574','#8A6651','#B4A18E'];
  var lastX = null, lastY = null, live = 0, MAX = 36;
  zone.addEventListener('mousemove', function(e){
    if (lastX !== null){
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (dx*dx + dy*dy < 580) return;
    }
    lastX = e.clientX; lastY = e.clientY;
    if (live >= MAX) return;
    var d = document.createElement('span');
    d.className = 'paint-dab';
    var s = 7 + Math.random() * 8;
    d.style.width = s + 'px';
    d.style.height = (s * 0.85) + 'px';
    d.style.left = (e.clientX - s / 2) + 'px';
    d.style.top = (e.clientY - s / 2) + 'px';
    d.style.background = PIGMENTS[(Math.random() * PIGMENTS.length) | 0];
    document.body.appendChild(d);
    live++;
    d.addEventListener('animationend', function(){ d.remove(); live--; });
  });
})();