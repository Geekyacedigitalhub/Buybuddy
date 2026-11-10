import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../../lib/ask.jsx';
import { api, naira, shortDate, assetUrl } from '../../lib/api.js';
import {
  Badge, Button, Empty, Icon, Loading, Modal, Money, SectionHead, Skeleton, Stars, StatusBadge,
  Textarea, useAuth, useCart, useToast,
} from '../../lib/ui.jsx';

/* --------------------------------- home ---------------------------------- */

/* Category art: a photograph of what the aisle actually holds. */
const CATEGORY_PHOTOS = [
  [/grocer|supermarket/i, 'rice'],
  [/food|restaurant/i, 'jollof'],
  [/fashion|clothing/i, 'fashion'],
  [/electronic|gadget/i, 'electronics'],
  [/pharmacy|health/i, 'pharmacy'],
  [/beauty|personal/i, 'beauty'],
  [/home|household/i, 'home'],
  [/drink|beverage/i, 'drinks'],
  [/baby/i, 'baby'],
  [/shop for me/i, 'pantry'],
];
export const categoryPhoto = (name) => {
  const hit = CATEGORY_PHOTOS.find(([re]) => re.test(name || ''));
  return `/img/products/${hit ? hit[1] : 'pantry'}.jpg`;
};

export function Home() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [slide, setSlide] = useState(0);
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    api.get('/api/home').then(setData).catch(() => setData({ categories: [], banners: [], popular_stores: [], recommended: [], deals: [], recent: [] }));
  }, []);

  useEffect(() => {
    if (!data?.banners?.length) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % data.banners.length), 5200);
    return () => clearInterval(t);
  }, [data]);

  if (!data) {
    return (
      <div className="page col" style={{ gap: 16 }}>
        <Skeleton h={132} />
        <div className="row" style={{ gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={74} w={74} />)}
        </div>
        <Skeleton h={180} />
      </div>
    );
  }

  const banner = data.banners[slide];

  return (
    <div className="page col" style={{ gap: 22 }}>
      <div>
        <div className="row-between">
          <div>
            <div className="sub">Delivering to</div>
            <div className="row" style={{ gap: 5, fontWeight: 700, fontSize: 14.5 }}>
              <Icon name="pin" size={15} /> Lekki Phase 1, Lagos <Icon name="down" size={14} />
            </div>
          </div>
          <Badge tone="badge-green">{user ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome'}</Badge>
        </div>

        <form
          className="searchbar"
          style={{ marginTop: 12 }}
          onSubmit={(e) => { e.preventDefault(); nav(`/search?q=${encodeURIComponent(q)}`); }}
        >
          <Icon name="search" size={19} style={{ color: 'var(--ink-3)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you need today?" aria-label="Search" />
          <button className="btn btn-primary btn-sm" type="submit">Search</button>
        </form>
      </div>

      {banner && (
        <button
          className="hero hero-photo"
          onClick={() => nav('/shop-for-me')}
          style={{ textAlign: 'left', border: 'none', cursor: 'pointer', padding: 0, overflow: 'hidden', position: 'relative' }}
        >
          {banner.image && !banner.image.startsWith('data:') ? (
            <img
              src={assetUrl(banner.image)}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              loading="lazy"
            />
          ) : null}
          <div style={{
            position: 'relative',
            background: `linear-gradient(100deg, ${banner.bg_color}F2 8%, ${banner.bg_color}B3 46%, ${banner.bg_color}10 92%)`,
            padding: '20px 18px', minHeight: 132, display: 'flex', alignItems: 'center',
          }}>
            <div style={{ maxWidth: 320 }}>
              <div style={{ fontSize: 21, fontWeight: 780, letterSpacing: '-0.4px' }}>{banner.title}</div>
              <div style={{ opacity: 0.9, marginTop: 6, fontSize: 13.5, lineHeight: 1.5 }}>{banner.subtitle}</div>
              <span className="badge" style={{ marginTop: 14, background: '#fff', color: 'var(--green-800)' }}>
                {banner.cta_label} <Icon name="right" size={13} />
              </span>
            </div>
          </div>
        </button>
      )}

      <section>
        <SectionHead title="Shop by category" action={<button className="btn btn-ghost btn-sm" onClick={() => nav('/browse')}>See all</button>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 }}>
          {data.categories.slice(0, 10).map((c) => (
            <Link key={c.id} to={`/category/${c.id}`} className="cat-tile">
              <img src={categoryPhoto(c.name)} alt="" loading="lazy" />
              <span className="cat-tile-label">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <button
        className="card"
        onClick={() => nav('/shop-for-me')}
        style={{ display: 'flex', gap: 14, alignItems: 'center', textAlign: 'left', cursor: 'pointer', border: '1px dashed var(--green-600)', background: 'linear-gradient(120deg, var(--green-50), #fff)' }}
      >
        <div style={{ width: 52, height: 52,                 borderRadius: 16, background: 'var(--green-700)', display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}>
          <Icon name="camera" size={24} />
        </div>
        <div className="grow">
          <div className="h3">Shop for me — anything, from anywhere</div>
          <div className="sub">Snap a photo or type a list. A buddy buys it and brings it to you.</div>
        </div>
        <Icon name="right" style={{ color: 'var(--green-700)' }} />
      </button>

      {data.recent?.length > 0 && (
        <section>
          <SectionHead title="Buy again" />
          <div className="row" style={{ gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {data.recent.slice(0, 8).map((p) => (
              <div key={p.id} style={{ width: 118, flex: 'none' }}>
                <ProductCard product={p} compact />
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Popular stores near you" action={<button className="btn btn-ghost btn-sm" onClick={() => nav('/browse')}>Browse</button>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {data.popular_stores.map((s) => (
            <Link key={s.id} to={`/store/${s.id}`} className="store-card">
              <span className="store-logo"><img src={assetUrl(s.logo)} alt="" /></span>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="strong" style={{ fontSize: 14 }}>{s.name}</span>
                  {!s.is_open && <Badge tone="badge-danger">Closed</Badge>}
                </div>
                <div className="sub">{s.area} • {s.prep_minutes} min</div>
                <div className="row" style={{ gap: 8, marginTop: 3 }}>
                  <Stars value={s.rating_avg} count={s.rating_count} />
                  <span className="tiny muted">{s.product_count} items</span>
                </div>
              </div>
              <Icon name="right" size={16} style={{ color: 'var(--ink-3)' }} />
            </Link>
          ))}
        </div>
      </section>

      {data.deals?.length > 0 && (
        <section>
          <SectionHead title="Today's deals" subtitle="Discounted by stores — while stock lasts" />
          <div className="prod-grid">
            {data.deals.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Recommended for you" />
        <div className="prod-grid">
          {data.recommended.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      <div className="card" style={{ background: 'var(--green-900)', color: '#fff', border: 'none' }}>
        <div className="row-between wrap">
          <div>
            <div className="h3">Need help with an order?</div>
            <div style={{ opacity: 0.75, fontSize: 13, marginTop: 3 }}>Chat with support — we reply in minutes.</div>
          </div>
          <Link to="/support" className="btn btn-accent btn-sm"><Icon name="chat" size={15} /> Contact support</Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ product card ----------------------------- */

export function ProductCard({ product, compact }) {
  const nav = useNavigate();
  const { reload } = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await api.post('/api/cart', { product_id: product.id, qty: 1 });
      await reload();
      toast.success(`${product.name} added to cart`);
    } catch (err) {
      if (err.payload?.code === 'store_conflict') {
        const fresh = await askConfirm({
          title: 'Start a new cart?',
          message: err.message,
          detail: 'A cart belongs to one store so the rider collects everything in one trip. Starting again empties the cart you already have.',
          confirmLabel: 'Empty my cart and add this',
          cancelLabel: 'Keep my cart',
        });
        if (fresh) {
          await api.del('/api/cart');
          await api.post('/api/cart', { product_id: product.id, qty: 1 });
          await reload();
          toast.success('New cart started');
        }
      } else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prod" onClick={() => nav(`/product/${product.id}`)} role="button" tabIndex={0}>
      <div className="prod-img">
        <img src={assetUrl(product.image)} alt={product.name} loading="lazy" />
        {product.compare_at > product.price && (
          <span className="badge badge-orange" style={{ position: 'absolute', top: 8, left: 8 }}>
            -{Math.round(((product.compare_at - product.price) / product.compare_at) * 100)}%
          </span>
        )}
        {!product.in_stock && (
          <span className="badge" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.72)', borderRadius: 0 }}>
            Out of stock
          </span>
        )}
      </div>
      <div className="prod-body">
        <div className="prod-name">{product.name}</div>
        {!compact && <div className="tiny muted">{product.store?.name}</div>}
        <div className="spacer" />
        {/* At 172 px the struck-through price used to run under the + button.
            The price block may wrap onto a second line; the button keeps its gap. */}
        <div className="prod-foot">
          <Money value={product.price} old={product.compare_at} />
          <button
            className="btn btn-primary btn-icon prod-add"
            onClick={add}
            disabled={busy || !product.in_stock}
            aria-label={`Add ${product.name} to cart`}
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- search --------------------------------- */

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    const term = params.get('q') || '';
    setQ(term);
    if (!term) return setData(null);
    setBusy(true);
    api.get(`/api/search?q=${encodeURIComponent(term)}`)
      .then(setData)
      .catch(() => setData({ products: [], stores: [] }))
      .finally(() => setBusy(false));
  }, [params]);

  return (
    <div className="page col">
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); setParams({ q }); }}>
        <Icon name="search" size={19} style={{ color: 'var(--ink-3)' }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, stores, categories" autoFocus aria-label="Search" />
        <button className="btn btn-primary btn-sm" type="submit">Go</button>
      </form>

      {!params.get('q') && (
        <div className="col">
          <div className="h3">Trending searches</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {['Jollof rice', 'Rice', 'Milk', 'Pampers', 'Power bank', 'Lipstick', 'Eggs', 'Fan'].map((t) => (
              <button key={t} className="chip" onClick={() => setParams({ q: t })}>{t}</button>
            ))}
          </div>
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--orange-soft)', display: 'grid', placeItems: 'center', color: 'var(--orange)' }}><Icon name="camera" size={21} /></div>
              <div className="grow">
                <div className="strong">Can't find it?</div>
                <div className="sub">Send a photo and a shopper will find it for you.</div>
              </div>
              <Button size="sm" variant="accent" onClick={() => nav('/shop-for-me')}>Shop for me</Button>
            </div>
          </div>
        </div>
      )}

      {busy && <Loading label="Searching…" />}

      {data && !busy && (
        <>
          {data.stores?.length > 0 && (
            <section>
              <SectionHead title="Stores" />
              <div className="col" style={{ gap: 8 }}>
                {data.stores.map((s) => (
                  <Link key={s.id} to={`/store/${s.id}`} className="store-card">
                    <span className="store-logo"><img src={assetUrl(s.logo)} alt="" /></span>
                    <div className="grow">
                      <div className="strong" style={{ fontSize: 14 }}>{s.name}</div>
                      <div className="sub">{s.area}</div>
                    </div>
                    <Icon name="right" size={16} />
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section>
            <SectionHead title={`Products (${data.total})`} />
            {data.products.length === 0
              ? <Empty icon="search" title="No match" body={`We couldn't find "${params.get('q')}". Try another word, or ask a shopper to get it for you.`} action={<Button variant="accent" onClick={() => nav('/shop-for-me')}>Shop for me</Button>} />
              : <div className="prod-grid">{data.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
          </section>
        </>
      )}
    </div>
  );
}

/* -------------------------------- browse --------------------------------- */

export function Browse() {
  const { id } = useParams();
  const [cats, setCats] = useState([]);
  const [products, setProducts] = useState([]);
  const [sort, setSort] = useState('popular');
  const [priceMax, setPriceMax] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/categories').then((r) => setCats(r.categories)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ sort, limit: '40' });
    if (id) p.set('category', id);
    if (priceMax) p.set('max_price', priceMax);
    api.get(`/api/products?${p}`).then((r) => setProducts(r.products)).catch(() => setProducts([])).finally(() => setLoading(false));
  }, [id, sort, priceMax]);

  const active = cats.find((c) => c.id === id);

  return (
    <div className="page col">
      <SectionHead title={active ? active.name : 'Discover everything'} subtitle={active ? `${products.length} items available` : 'Fresh groceries, food, tech and more'} />
      <div className="chips">
        <button className={`chip ${!id ? 'active' : ''}`} onClick={() => window.location.assign('#/browse')}>All</button>
        {cats.filter((c) => c.slug !== 'shop-for-me').map((c) => (
          <button key={c.id} className={`chip ${id === c.id ? 'active' : ''}`} onClick={() => window.location.assign(`#/category/${c.id}`)}>
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          <Icon name="filter" size={16} style={{ color: 'var(--ink-3)' }} />
          <select className="select" style={{ width: 168, padding: '8px 10px' }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="popular">Most popular</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="rating">Top rated</option>
            <option value="newest">Newest</option>
          </select>
        </div>
        <select className="select" style={{ width: 160, padding: '8px 10px' }} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} aria-label="Max price">
          <option value="">Any price</option>
          <option value="2000">Under ₦2,000</option>
          <option value="5000">Under ₦5,000</option>
          <option value="15000">Under ₦15,000</option>
          <option value="50000">Under ₦50,000</option>
        </select>
      </div>

      {loading ? <Loading /> : products.length === 0
        ? <Empty title="Nothing here yet" body="This category has no products right now." />
        : <div className="prod-grid">{products.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
    </div>
  );
}

/* --------------------------------- store --------------------------------- */

export function StorePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    api.get(`/api/stores/${id}`).then(setData).catch(() => setData(null));
  }, [id]);

  if (!data) return <Loading />;
  const { store, products, categories } = data;
  const list = cat ? products.filter((p) => p.category_id === cat) : products;

  return (
    <div className="page col">
      <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)} style={{ alignSelf: 'flex-start' }}><Icon name="left" /></button>
      {store.cover && (
        <div className="store-cover">
          <img src={assetUrl(store.cover)} alt="" loading="lazy" />
        </div>
      )}
      <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span className="store-logo" style={{ width: 64, height: 64 }}><img src={assetUrl(store.logo)} alt="" /></span>
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <span className="h2">{store.name}</span>
            {store.is_open ? <Badge tone="badge-ok">Open</Badge> : <Badge tone="badge-danger">Closed</Badge>}
          </div>
          <div className="sub">{store.description}</div>
          <div className="row wrap" style={{ gap: 12, marginTop: 6 }}>
            <Stars value={store.rating_avg} count={store.rating_count} />
            <span className="tiny muted"><Icon name="pin" size={11} style={{ verticalAlign: -1 }} /> {store.area}</span>
            <span className="tiny muted"><Icon name="clock" size={11} style={{ verticalAlign: -1 }} /> {store.opens_at}–{store.closes_at}</span>
            <span className="tiny muted">Min ₦{store.min_order.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="chips">
          <button className={`chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>All items</button>
          {categories.map((c) => (
            <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.icon} {c.name}</button>
          ))}
        </div>
      )}

      {list.length === 0
        ? <Empty title="No products listed" />
        : <div className="prod-grid">{list.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
    </div>
  );
}

/* -------------------------------- product -------------------------------- */

export function ProductPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [qty, setQty] = useState(1);
  const [fav, setFav] = useState(false);
  const { reload } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [failed, setFailed] = useState(false);
  // On a phone the inline Add-to-cart row sits below the fold, behind the fixed
  // bottom nav, so the main action looked missing. Once that row scrolls out of
  // view we float a bar holding the price and the button just above the nav.
  const addRowRef = useRef(null);
  const [showBuyBar, setShowBuyBar] = useState(false);

  useEffect(() => {
    const el = addRowRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => setShowBuyBar(!e.isIntersecting),
      { rootMargin: '-72px 0px -120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [data]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.get(`/api/products/${id}`)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/favourites').then((r) => setFav(r.favourites.some((f) => f.id === id))).catch(() => {});
  }, [id, user]);

  if (failed) {
    return (
      <div className="page page-tight">
        <Empty
          title="This item is no longer listed"
          body="The store may have taken it down. Browse the aisle again, or ask a personal shopper to find it for you."
          action={<Button onClick={() => nav('/browse')}>Browse the shop</Button>}
        />
      </div>
    );
  }
  if (!data) return <Loading />;
  const { product, store, related, reviews } = data;

  const add = async () => {
    if (!user) { nav('/login'); return; }
    try {
      await api.post('/api/cart', { product_id: product.id, qty });
      await reload();
      toast.success('Added to cart');
    } catch (err) {
      if (err.payload?.code === 'store_conflict') {
        const fresh = await askConfirm({
          title: 'Start a new cart?',
          message: err.message,
          detail: 'A cart belongs to one store so the rider collects everything in one trip. Starting again empties the cart you already have.',
          confirmLabel: 'Empty my cart and add this',
          cancelLabel: 'Keep my cart',
        });
        if (fresh) {
          await api.del('/api/cart');
          await api.post('/api/cart', { product_id: product.id, qty });
          await reload();
          toast.success('New cart started');
        }
      } else toast.error(err.message);
    }
  };

  const toggleFav = async () => {
    if (!user) { nav('/login'); return; }
    const r = await api.post(`/api/favourites/${product.id}`);
    setFav(r.favourite);
    toast.success(r.favourite ? 'Saved to favourites' : 'Removed from favourites');
  };

  return (
    <div className="page page-tight col">
      <div className="row-between">
        <button className="btn btn-ghost btn-icon" onClick={() => nav(-1)}><Icon name="left" /></button>
        <button className="btn btn-ghost btn-icon" onClick={toggleFav} aria-label="Favourite">
          <Icon name="heart" fill={fav ? 'var(--orange)' : 'none'} stroke={fav ? 'var(--orange)' : 'currentColor'} />
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 18 }}>
        <div className="card card-flush" style={{ padding: 0 }}>
          <img src={assetUrl(product.image)} alt={product.name} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover' }} />
        </div>

        <div className="col" style={{ gap: 8 }}>
          <Link to={`/store/${store.id}`} className="row" style={{ gap: 8 }}>
            <span className="store-logo" style={{ width: 30, height: 30, borderRadius: 9 }}><img src={assetUrl(store.logo)} alt="" /></span>
            <span className="strong" style={{ fontSize: 13 }}>{store.name}</span>
            <Icon name="right" size={14} style={{ color: 'var(--ink-3)' }} />
          </Link>
          <div className="h1">{product.name}</div>
          <Stars value={product.rating_avg} count={product.rating_count} />
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span className="price mono" style={{ fontSize: 24 }}>{naira(product.price)}</span>
            {product.compare_at > product.price && <span className="price-old mono">{naira(product.compare_at)}</span>}
            {product.compare_at > product.price && (
              <Badge tone="badge-orange">Save {naira(product.compare_at - product.price)}</Badge>
            )}
          </div>
          <div className="sub">{product.description}</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Badge tone={product.in_stock ? 'badge-ok' : 'badge-danger'}>{product.in_stock ? `${product.stock} in stock` : 'Out of stock'}</Badge>
            <Badge>Unit: {product.unit}</Badge>
            <Badge>Delivered in ~{store.prep_minutes + 20} min</Badge>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 8 }} ref={addRowRef}>
            <div className="row" style={{ gap: 0, border: '1px solid var(--line)', borderRadius: 12, padding: 4 }}>
              <button className="btn btn-ghost btn-icon" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease"><Icon name="minus" size={16} /></button>
              <span className="mono" style={{ width: 34, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setQty(qty + 1)} aria-label="Increase"><Icon name="plus" size={16} /></button>
            </div>
            <Button size="lg" onClick={add} disabled={!product.in_stock} className="grow">
              <Icon name="bag" size={17} /> Add to cart · {naira(product.price * qty)}
            </Button>
          </div>
        </div>
      </div>

      {reviews?.length > 0 && (
        <section>
          <SectionHead title="Customer reviews" />
          <div className="col" style={{ gap: 10 }}>
            {reviews.map((r) => (
              <div key={r.id} className="card">
                <div className="row-between">
                  <span className="strong">{r.customer_name}</span>
                  <Stars value={r.rating} />
                </div>
                <div className="sub" style={{ marginTop: 4 }}>{r.comment}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {related?.length > 0 && (
        <section>
          <SectionHead title="You may also like" />
          <div className="prod-grid">{related.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}

      {showBuyBar && (
        <div className="pdp-buybar">
          <div className="row-between" style={{ gap: 12 }}>
            <div className="col" style={{ gap: 1 }}>
              <span className="price mono" style={{ fontSize: 16 }}>{naira(product.price * qty)}</span>
              <span className="tiny muted">{qty} × {naira(product.price)}</span>
            </div>
            <Button onClick={add} disabled={!product.in_stock}>
              <Icon name="bag" size={16} /> {product.in_stock ? 'Add to cart' : 'Out of stock'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
