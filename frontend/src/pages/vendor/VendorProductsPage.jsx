import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiBox, FiEdit2, FiTrash2, FiPlus, FiSearch,
} from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants } from '../../components/dashboard/variants';
import Modal from '../../components/common/Modal';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import './vendor-design.css';

const CATEGORY_EMOJI = {
  Diagnostic: '🔬', Imaging: '📡', Respiratory: '💨',
  Surgical: '✂️', equipment: '🔬', medicine: '💊', supply: '📦',
};

const ProductImage = ({ image_url, product_name, category }) => {
  const [imgError, setImgError] = useState(false);
  if (image_url && image_url.startsWith('http') && !imgError) {
    return <img src={image_url} alt={product_name} onError={() => setImgError(true)} />;
  }
  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 6, color: 'var(--v-ink-3)' }}>
      <span style={{ fontSize: 42 }}>{CATEGORY_EMOJI[category] || '🏥'}</span>
      <span style={{ fontSize: 11, padding: '0 12px', textAlign: 'center' }}>{product_name}</span>
    </div>
  );
};

const stockLevel = (qty) => {
  if (qty <= 0) return { cls: 'crit', label: 'Out of stock' };
  if (qty < 5) return { cls: 'crit', label: 'Critical' };
  if (qty <= 10) return { cls: 'low', label: 'Low stock' };
  return { cls: '', label: 'In stock' };
};

const emptyForm = { product_name: '', category: '', specifications: '', price: '', stock_qty: '', max_order_qty: 100, image_url: '' };

const VendorProductsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [productModal, setProductModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const { data: productsRaw, refetch } = useApi('/api/vendor/products/');
  const products = Array.isArray(productsRaw) ? productsRaw : [];

  function openAdd() {
    setEditProduct(null);
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview('');
    setProductModal(true);
  }

  useEffect(() => {
    if (location.pathname.endsWith('/add')) {
      openAdd();
      navigate('/vendor/products', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const cats = useMemo(() => {
    const c = {};
    products.forEach((p) => { if (p.category) c[p.category] = (c[p.category] || 0) + 1; });
    return [['All', products.length], ...Object.entries(c)];
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const catOk = categoryFilter === 'All' || p.category === categoryFilter;
      const qOk = !q || p.product_name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q);
      return catOk && qOk;
    });
  }, [products, search, categoryFilter]);

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file) => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await API.post('/api/hospital/upload-image/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return r.data?.data?.image_url || '';
    } catch {
      throw new Error('Image upload failed.');
    } finally {
      setUploadingImage(false);
    }
  };

  const openEdit = (p) => {
    setEditProduct(p);
    setForm({
      product_name: p.product_name || '',
      category: p.category || '',
      specifications: typeof p.specifications === 'object'
        ? JSON.stringify(p.specifications, null, 2)
        : p.specifications || '',
      price: p.price || '',
      stock_qty: p.stock_qty || '',
      max_order_qty: p.max_order_qty || 100,
      image_url: p.image_url || '',
    });
    setImageFile(null);
    setImagePreview(p.image_url || '');
    setProductModal(true);
  };

  const saveProduct = async () => {
    if (!form.product_name || !form.price) {
      toast.error('Product name and price are required.');
      return;
    }
    setSaving(true);
    try {
      let specs = form.specifications;
      try { specs = JSON.parse(form.specifications); } catch { /* keep as string */ }
      let imageUrl = form.image_url;
      if (imageFile) imageUrl = await uploadImage(imageFile);
      const payload = { ...form, specifications: specs, image_url: imageUrl };
      if (editProduct) {
        await API.put(`/api/vendor/products/${editProduct.product_id}/`, payload);
        toast.success('Product updated');
      } else {
        await API.post('/api/vendor/products/create/', payload);
        toast.success('Product added');
      }
      setProductModal(false);
      setImageFile(null);
      setImagePreview('');
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Delete this product?')) return;
    setDeletingId(id);
    try {
      await API.delete(`/api/vendor/products/${id}/`);
      toast.success('Product deleted');
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible" className="v-scope v-page">
        <div className="v-page-head">
          <div>
            <h1 className="v-page-title">Products <span className="accent">·</span> Catalog</h1>
            <p className="v-page-sub">
              {products.length} active listing{products.length === 1 ? '' : 's'}
              {cats.length > 1 ? ` across ${cats.length - 1} categories` : ''}
            </p>
          </div>
          <div className="v-page-actions">
            <button type="button" onClick={openAdd} className="v-btn-primary">
              <FiPlus style={{ width: 14, height: 14 }} /> Add product
            </button>
          </div>
        </div>

        <div className="v-toolbar">
          <div className="v-chip-row">
            {cats.map(([name, n]) => (
              <button
                key={name}
                type="button"
                className={`v-chip${categoryFilter === name ? ' active' : ''}`}
                onClick={() => setCategoryFilter(name)}
              >
                {name} <span className="count">{n}</span>
              </button>
            ))}
          </div>
          <div className="v-toolbar-right">
            <div className="v-toolbar-search">
              <FiSearch style={{ width: 14, height: 14, color: 'var(--v-ink-3)' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search catalog…" />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="v-card" style={{ textAlign: 'center', padding: 56, color: 'var(--v-ink-3)' }}>
            <FiBox style={{ width: 36, height: 36, margin: '0 auto 10px', opacity: 0.4 }} />
            <p style={{ margin: 0 }}>No products match. Try clearing filters or add your first product.</p>
          </div>
        ) : (
          <div className="v-product-grid">
            {filtered.map((p, i) => {
              const lvl = stockLevel(Number(p.stock_qty || 0));
              const total = Math.max(Number(p.stock_qty || 0), 20);
              const ratio = Math.min(1, Number(p.stock_qty || 0) / total);
              return (
                <motion.div
                  key={p.product_id}
                  className="v-product-card"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="v-product-img">
                    <ProductImage image_url={p.image_url} product_name={p.product_name} category={p.category} />
                    {p.category && <span className="v-product-tag">{p.category}</span>}
                  </div>
                  <div className="v-product-body">
                    <div className="v-product-cat">{p.category || 'Uncategorised'}</div>
                    <div className="v-product-name">{p.product_name}</div>
                    <div className="v-product-meta">
                      <span>{lvl.label}</span>
                      <div className={`v-stock-bar ${lvl.cls}`}>
                        <span style={{ width: `${Math.max(4, ratio * 100)}%` }} />
                      </div>
                      <span>{p.stock_qty}</span>
                    </div>
                    <div className="v-product-foot">
                      <div className="v-product-price">
                        ₹{Number(p.price || 0).toLocaleString('en-IN')}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="v-icon-btn"
                          title="Edit product"
                          aria-label="Edit product"
                        >
                          <FiEdit2 style={{ width: 14, height: 14 }} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProduct(p.product_id)}
                          disabled={deletingId === p.product_id}
                          className="v-icon-btn danger"
                          title="Delete product"
                          aria-label="Delete product"
                        >
                          <FiTrash2 style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Add / Edit modal */}
      <Modal
        isOpen={productModal}
        onClose={() => setProductModal(false)}
        title={editProduct ? 'Edit Product' : 'Add Product'}
        size="md"
      >
        <div className="space-y-4">
          {[
            { label: 'Product Name', key: 'product_name', placeholder: 'e.g. Digital Stethoscope' },
            { label: 'Category', key: 'category', placeholder: 'e.g. Diagnostic' },
            { label: 'Price (₹)', key: 'price', placeholder: '0.00', type: 'number' },
            { label: 'Stock Qty', key: 'stock_qty', placeholder: '0', type: 'number' },
            { label: 'Max Order Limit', key: 'max_order_qty', placeholder: '100', type: 'number' },
          ].map(({ label, key, placeholder, type = 'text' }) => (
            <div key={key}>
              <label className="text-xs text-muted">{label}</label>
              <input
                type={type}
                className="input mt-1"
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
              />
            </div>
          ))}

          <div>
            <label className="text-xs text-muted">Product Image</label>
            <div className="mt-1">
              {imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="Preview" className="w-full h-40 object-cover rounded-xl" />
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(''); setForm((p) => ({ ...p, image_url: '' })); }}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label className="border-2 border-dashed border-hairline rounded-xl p-6 text-center cursor-pointer hover:border-orange-400 block transition">
                  <span className="text-3xl">📸</span>
                  <p className="text-sm text-muted mt-2">Click to upload product image</p>
                  <p className="text-xs text-gray-400">JPG, PNG up to 5MB</p>
                  <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted">Specifications (JSON)</label>
            <textarea
              className="input mt-1 h-24 resize-none font-mono text-xs"
              value={form.specifications}
              onChange={(e) => setForm((p) => ({ ...p, specifications: e.target.value }))}
              placeholder='{"weight": "200g", "warranty": "1 year"}'
            />
          </div>

          <button onClick={saveProduct} disabled={saving || uploadingImage} className="btn-orange w-full">
            {uploadingImage ? 'Uploading image…' : saving ? 'Saving…' : editProduct ? 'Update Product' : 'Add Product'}
          </button>
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default VendorProductsPage;
