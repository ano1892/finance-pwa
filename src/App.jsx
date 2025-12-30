import React, { useState, useMemo, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInAnonymously,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  deleteDoc
} from 'firebase/firestore';
import { 
  Wallet, TrendingUp, CreditCard, History, Plus, 
  ArrowUpRight, ArrowDownLeft, ArrowRightLeft, 
  Fuel, Utensils, Baby, Receipt, Settings, Edit2, 
  Calendar, Save, Trash2, CheckCircle2, Banknote, 
  Eye, EyeOff, BarChart3, X, AlertCircle, ShoppingBag,
  Loader2 
} from 'lucide-react';

// --- 1. FIREBASE CONFIGURATION & INITIALIZATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBQWLoGcN-k2EXmKyEjWUiJL-jBWd3MzoI",
  authDomain: "myfinanceapp-9da14.firebaseapp.com",
  projectId: "myfinanceapp-9da14",
  storageBucket: "myfinanceapp-9da14.firebasestorage.app",
  messagingSenderId: "252644925644",
  appId: "1:252644925644:web:f3a96b5cc45f808c3e6269"
};

// Inisialisasi di luar komponen agar stabil
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.appId; 

const App = () => {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showBalances, setShowBalances] = useState(true);
  
  const [accounts, setAccounts] = useState([]);
  const [baseBudget, setBaseBudget] = useState([]);
  const [debts, setDebts] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [editingTxId, setEditingTxId] = useState(null);
  const [payDebtMode, setPayDebtMode] = useState(null);
  
  // State form transaksi baru
  const [newTx, setNewTx] = useState({ 
    desc: '', 
    amount: '', 
    type: 'out', 
    category: '', 
    fromAccountId: 1,
    toAccountId: 2
  });

  const [editData, setEditData] = useState({ bankBalance: 0, cashBalance: 0, budgets: [], debts: [] });

  // --- AUTH LOGIC ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof window !== 'undefined' && window.__initial_auth_token) {
        try {
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } catch (e) {
          console.error("Custom token fail, fallback anon", e);
          await signInAnonymously(auth);
        }
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- DATA FETCHING ---
  useEffect(() => {
    if (!user) return;

    // 1. Ambil Data Transaksi
    const txCol = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const unsubTx = onSnapshot(txCol, (snap) => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.userId === user.uid)
        .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setTransactions(docs);
      setLoading(false);
    }, (err) => console.error("Tx sync error:", err));

    // 2. Ambil Data Settings (Akun, Budget, Hutang)
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'data');
    const unsubSettings = onSnapshot(settingsRef, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        const fetchedBudget = d.budget || [];
        
        setAccounts(d.accounts || []);
        setBaseBudget(fetchedBudget);
        setDebts(d.debts || []);
        
        setEditData({
          bankBalance: d.accounts?.find(a => a.type === 'bank')?.balance || 0,
          cashBalance: d.accounts?.find(a => a.type === 'cash')?.balance || 0,
          budgets: fetchedBudget,
          debts: d.debts || []
        });

        // FIX: Update state newTx jika kategori masih kosong saat load awal
        if (fetchedBudget.length > 0) {
           setNewTx(prev => ({
               ...prev,
               category: prev.category || fetchedBudget[0].category
           }));
        }

      } else {
        seedInitialData(user.uid);
      }
    }, (err) => console.error("Settings sync error:", err));

    return () => { unsubTx(); unsubSettings(); };
  }, [user]);

  const seedInitialData = async (uid) => {
    const settingsRef = doc(db, 'artifacts', appId, 'users', uid, 'settings', 'data');
    await setDoc(settingsRef, {
      accounts: [
        { id: 1, name: 'Bank', balance: 0, type: 'bank' },
        { id: 2, name: 'Kas', balance: 0, type: 'cash' },
      ],
      budget: [
        { category: 'Makan&Minum', planned: 0 },
        { category: 'Bensin', planned: 0 },
        { category: 'Tagihan', planned: 0 },
      ],
      debts: []
    });
  };

  // --- LOGIKA PERHITUNGAN ---
  const dynamicBalances = useMemo(() => {
    const bal = { 
      bank: Number(accounts.find(a => a.type === 'bank')?.balance || 0), 
      cash: Number(accounts.find(a => a.type === 'cash')?.balance || 0) 
    };
    transactions.forEach(t => {
      const amt = Number(t.amount || 0);
      const fromId = Number(t.fromAccountId);
      if (t.type === 'in') {
        if (fromId === 1) bal.bank += amt; else bal.cash += amt;
      } else if (t.type === 'out') {
        if (fromId === 1) bal.bank -= amt; else bal.cash -= amt;
      } else if (t.type === 'transfer') {
        if (fromId === 1) { bal.bank -= amt; bal.cash += amt; }
        else { bal.cash -= amt; bal.bank += amt; }
      }
    });
    return bal;
  }, [accounts, transactions]);

  const computedBudget = useMemo(() => {
    return baseBudget.map(b => {
      const actual = transactions
        .filter(t => 
          t.type === 'out' && 
          t.category && 
          t.category.trim().toLowerCase() === b.category.trim().toLowerCase()
        )
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
      return { ...b, actual };
    });
  }, [baseBudget, transactions]);

  const currentMonthYear = useMemo(() => new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }), []);
  const totalPlannedBudget = useMemo(() => baseBudget.reduce((s, b) => s + Number(b.planned), 0), [baseBudget]);
  
  const totalSpent = useMemo(() => 
    transactions
      .filter(t => t.type === 'out')
      .reduce((s, t) => s + Number(t.amount || 0), 0),
  [transactions]);

  const sisaAnggaran = totalPlannedBudget - totalSpent;

  const analysisData = useMemo(() => {
    const filtered = transactions.filter(t => t.type !== 'transfer');
    const income = filtered.filter(t => t.type === 'in').reduce((s, t) => s + Number(t.amount), 0);
    const expense = filtered.filter(t => t.type === 'out').reduce((s, t) => s + Number(t.amount), 0);
    const cats = {};
    filtered.filter(t => t.type === 'out').forEach(t => { cats[t.category] = (cats[t.category] || 0) + Number(t.amount); });
    return { income, expense, sortedCats: Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([name, val]) => ({ name, val })) };
  }, [transactions]);

  // --- ACTIONS (Logika Simpan, Edit, Hapus) ---
  const handleTransaction = async (e) => {
    e.preventDefault();
    if (!user) return;

    // Bersihkan input angka
    const cleanAmount = String(newTx.amount).replace(/[^0-9]/g, '');
    const numericAmount = Number(cleanAmount);
    
    // FIX BUG KATEGORI: Jika user tidak klik dropdown, paksa pakai kategori pertama
    let finalCategory = newTx.category;
    if (!finalCategory && newTx.type === 'out') {
        finalCategory = baseBudget.length > 0 ? baseBudget[0].category : 'Lain-lain';
    }

    const payload = { 
      ...newTx, 
      userId: user.uid,
      amount: numericAmount,
      category: finalCategory,
      // Jika edit, jangan update timestamp agar urutan tidak berubah
      // Jika baru, gunakan serverTimestamp
      ...(editingTxId ? {} : { timestamp: serverTimestamp() }),
      date: newTx.date || new Date().toISOString().split('T')[0] 
    };

    try {
      if (editingTxId) {
        // --- LOGIKA EDIT ---
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', editingTxId), payload);
      } else {
        // --- LOGIKA BARU ---
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'transactions'), payload);

        // Update Hutang (Hanya jika tambah baru)
        if (payDebtMode) {
          const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'data');
          const updatedDebts = debts.map(d => {
            if (d.name === payDebtMode.name) {
              return { ...d, amount: Math.max(0, d.amount - numericAmount) };
            }
            return d;
          });
          await updateDoc(settingsRef, { debts: updatedDebts });
        }
      }
      closeModal();
    } catch (err) {
      console.error("Gagal menyimpan:", err);
      alert("Terjadi kesalahan penyimpanan.");
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTxId(null);
    setPayDebtMode(null);
    
    // Reset form dengan default value yang aman
    const defaultCat = baseBudget.length > 0 ? baseBudget[0].category : 'Lain-lain';
    setNewTx({ 
      desc: '', 
      amount: '', 
      type: 'out', 
      category: defaultCat, 
      fromAccountId: 1, 
      toAccountId: 2 
    });
  };

  const handleUpdateSettings = async (e) => {
    e.preventDefault();
    if (!user) return;
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'data');
    await updateDoc(settingsRef, {
      accounts: [
        { id: 1, name: 'Bank', balance: Number(editData.bankBalance), type: 'bank' }, 
        { id: 2, name: 'Kas', balance: Number(editData.cashBalance), type: 'cash' }
      ],
      budget: editData.budgets, 
      debts: editData.debts
    });
    setIsSettingsOpen(false);
  };

  const openPayDebt = (debt) => {
    setPayDebtMode(debt);
    const defaultCat = baseBudget.find(b => 
      b.category.toLowerCase().includes('tagihan') || 
      b.category.toLowerCase().includes('bayar')
    )?.category || baseBudget[0]?.category || 'Lain-lain';
    
    setNewTx({
      desc: `Bayar Tagihan ${debt.name}`,
      amount: debt.amount,
      type: 'out',
      category: defaultCat,
      fromAccountId: 1,
      toAccountId: 2
    });
    setIsModalOpen(true);
  };

  // --- HELPERS ---
  const formatIDR = (val) => !showBalances ? "Rp •••••" : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

  const getIcon = (cat) => {
    const map = { 'Makan&Minum': <Utensils size={18}/>, 'Bensin': <Fuel size={18}/>, 'Kebutuhan': <ShoppingBag size={18}/>, 'Tagihan': <Receipt size={18}/>, 'Anak': <Baby size={18}/> };
    return map[cat] || <Wallet size={18}/>;
  };

  // CRUD Settings Helpers
  const addCategory = () => setEditData({...editData, budgets: [...editData.budgets, { category: 'Kategori Baru', planned: 0 }]});
  const deleteCategory = (i) => { const nb = [...editData.budgets]; nb.splice(i, 1); setEditData({...editData, budgets: nb}); };
  const updateCategory = (i, f, v) => { const nb = [...editData.budgets]; nb[i][f] = f === 'planned' ? Number(v) : v; setEditData({...editData, budgets: nb}); };
  const addDebt = () => setEditData({...editData, debts: [...editData.debts, { name: 'Tagihan Baru', amount: 0, limit: 0 }]});
  const deleteDebt = (i) => { const nd = [...editData.debts]; nd.splice(i, 1); setEditData({...editData, debts: nd}); };
  const updateDebtField = (i, f, v) => { const nd = [...editData.debts]; nd[i][f] = (f === 'amount' || f === 'limit') ? Number(v) : v; setEditData({...editData, debts: nd}); };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50">
      <div className="text-center space-y-4">
        <Loader2 className="animate-spin mx-auto text-amber-500" size={48} />
        <p className="text-amber-800 font-black uppercase tracking-widest text-xs">Sinkronisasi Cloud...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-amber-50 font-sans text-slate-900 max-w-md mx-auto shadow-2xl relative border-x border-amber-100/50">
      <div className="bg-white/70 backdrop-blur-lg px-4 py-4 flex justify-between items-center sticky top-0 z-40 border-b border-amber-100/50 shadow-sm">
        <div className="flex items-center gap-2">
          <Calendar size={20} className="text-amber-700" />
          <h1 className="text-lg font-black text-amber-900 uppercase tracking-tighter">
            {activeTab === 'analysis' ? 'Laporan' : currentMonthYear}
          </h1>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-amber-100 rounded-full text-amber-700 transition-colors">
          <Settings size={22}/>
        </button>
      </div>

      <main className="pb-32">
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-in fade-in duration-500 p-4">
            {/* KARTU EMAS UTAMA */}
            <div className="bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 text-amber-950 p-6 rounded-3xl shadow-xl relative overflow-hidden border border-amber-200/50">
              <button onClick={() => setShowBalances(!showBalances)} className="absolute top-4 right-4 p-2 bg-white/20 rounded-full">
                {showBalances ? <Eye size={18}/> : <EyeOff size={18}/>}
              </button>
              
              <div className="flex justify-between border-b border-amber-950/10 pb-4 mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Saldo Bank</p>
                  <h2 className="text-2xl font-bold tracking-tight">{formatIDR(dynamicBalances.bank)}</h2>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Saldo Kas</p>
                  <h2 className="text-2xl font-bold tracking-tight">{formatIDR(dynamicBalances.cash)}</h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/20 p-3 rounded-2xl">
                  <p className="text-[8px] font-black uppercase opacity-60">Total Anggaran</p>
                  <p className="font-bold text-sm">{formatIDR(totalPlannedBudget)}</p>
                </div>
                <div className="bg-amber-950/10 p-3 rounded-2xl">
                  <p className="text-[8px] font-black uppercase opacity-60">Terpakai</p>
                  <p className={`font-black text-sm ${totalSpent > totalPlannedBudget ? 'text-red-900 drop-shadow-sm' : 'text-amber-950'}`}>
                    {formatIDR(totalSpent)}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-amber-950/5">
                <div className="flex justify-between items-end mb-1.5">
                  <p className="text-[10px] font-black uppercase">Sisa Uang Anda</p>
                  <p className={`font-black text-sm ${sisaAnggaran < 0 ? 'text-red-900 underline decoration-red-900/50' : ''}`}>
                    {formatIDR(sisaAnggaran)}
                  </p>
                </div>
                <div className="h-1.5 bg-amber-950/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${sisaAnggaran < 0 ? 'bg-red-900/40' : 'bg-amber-950/40'}`} 
                    style={{ width: `${Math.max(Math.min((sisaAnggaran/totalPlannedBudget)*100, 100), 0)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => { setNewTx({...newTx, type: 'in'}); setIsModalOpen(true); }} className="bg-white p-4 rounded-2xl border border-amber-100 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-all text-green-600">
                <ArrowDownLeft size={20}/><span className="text-[10px] font-black uppercase">Masuk</span>
              </button>
              <button onClick={() => { setNewTx({...newTx, type: 'out'}); setIsModalOpen(true); }} className="bg-white p-4 rounded-2xl border border-amber-100 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-all text-red-600">
                <ArrowUpRight size={20}/><span className="text-[10px] font-black uppercase">Keluar</span>
              </button>
              <button onClick={() => { setNewTx({...newTx, type: 'transfer'}); setIsModalOpen(true); }} className="bg-white p-4 rounded-2xl border border-amber-100 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-all text-blue-600">
                <ArrowRightLeft size={20}/><span className="text-[10px] font-black uppercase tracking-tighter">Mutasi</span>
              </button>
            </div>

            <button onClick={() => setIsModalOpen(true)} className="w-full bg-slate-900 text-white p-5 rounded-[2rem] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3">
              <Plus size={20} strokeWidth={3} className="text-amber-500" /> Catat Transaksi
            </button>

            <div className="space-y-4">
              <h2 className="font-black text-amber-900 uppercase text-xs ml-1 tracking-widest">Detail Per Kategori</h2>
              <div className="bg-white/50 p-5 rounded-[2.5rem] space-y-5 border border-amber-100 shadow-sm">
                {computedBudget.map((item, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-sm font-bold text-amber-900">
                      <span className="flex items-center gap-2">{getIcon(item.category)} {item.category}</span>
                      <span>{formatIDR(item.actual)}</span>
                    </div>
                    <div className="h-2.5 bg-amber-100/50 rounded-full overflow-hidden border border-amber-100">
                      <div className={`h-full transition-all duration-1000 ${item.actual > item.planned ? 'bg-red-500' : 'bg-amber-500'}`} style={{width: `${Math.min((item.actual/item.planned)*100, 100)}%`}}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* --- TAB TRANSAKSI DENGAN FITUR EDIT --- */}
        {activeTab === 'transactions' && (
          <div className="p-4 space-y-4 animate-in fade-in">
            <h2 className="font-black text-amber-900 uppercase tracking-widest ml-1">Riwayat Transaksi</h2>
            <div className="space-y-3">
              {transactions.map(t => (
                <div key={t.id} className="bg-white p-4 rounded-[1.5rem] flex justify-between items-center group shadow-sm border border-amber-50 relative overflow-hidden">
                  
                  {/* Bagian Kiri: Klik untuk edit juga bisa */}
                  <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => { setEditingTxId(t.id); setNewTx(t); setIsModalOpen(true); }}>
                    <div className={`p-3 rounded-2xl ${t.type === 'in' ? 'bg-green-100 text-green-700' : t.type === 'out' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {t.type === 'in' ? <ArrowDownLeft size={20}/> : t.type === 'out' ? <ArrowUpRight size={20}/> : <ArrowRightLeft size={20}/>}
                    </div>
                    <div>
                      <p className="font-bold text-amber-950 leading-tight line-clamp-1">{t.desc || 'Tanpa Catatan'}</p>
                      <p className="text-[10px] text-amber-600 uppercase font-black tracking-widest mt-1 opacity-60">
                        {t.type === 'transfer' ? 'Pindah Saldo' : t.category} • {Number(t.fromAccountId) === 1 ? 'Bank' : 'Kas'}
                      </p>
                    </div>
                  </div>

                  {/* Bagian Kanan: Nominal & Tombol Edit */}
                  <div className="flex items-center gap-3">
                    <p className={`font-black text-lg ${t.type === 'in' ? 'text-green-700' : t.type === 'out' ? 'text-red-700' : 'text-blue-700'}`}>
                      {t.type === 'in' ? '+' : t.type === 'out' ? '-' : ''}{formatIDR(t.amount)}
                    </p>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setEditingTxId(t.id); 
                        setNewTx(t); 
                        setIsModalOpen(true); 
                      }} 
                      className="p-2 bg-amber-50 text-amber-600 rounded-full hover:bg-amber-200 transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && <p className="text-center text-xs opacity-50 font-bold py-10 uppercase">Belum ada transaksi</p>}
            </div>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="p-4 space-y-6 animate-in slide-in-from-right">
             <h2 className="font-black text-amber-900 uppercase tracking-widest ml-1">Analisa Pengeluaran</h2>
             <div className="bg-white p-6 rounded-[2.5rem] border border-amber-100 shadow-sm space-y-6">
                <div className="flex justify-between items-end border-b border-amber-50 pb-4">
                  <div><p className="text-[10px] font-black uppercase text-amber-900/40 tracking-widest">Total Keluar</p><p className="text-2xl font-black text-amber-950">{formatIDR(analysisData.expense)}</p></div>
                  <div className="text-right"><p className="text-[10px] font-black uppercase text-green-600/60 tracking-widest">Total Masuk</p><p className="text-lg font-black text-green-700">{formatIDR(analysisData.income)}</p></div>
                </div>
                {analysisData.sortedCats.map((cat, idx) => (
                   <div key={idx} className="space-y-2">
                      <div className="flex justify-between text-sm font-bold text-amber-950"><span>{cat.name}</span><span className="opacity-60">{formatIDR(cat.val)}</span></div>
                      <div className="h-2.5 bg-amber-50 rounded-full overflow-hidden border border-amber-100/30">
                          <div className="h-full bg-amber-400 rounded-full transition-all duration-700" style={{ width: `${(cat.val / (analysisData.expense || 1)) * 100}%` }}></div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        )}

        {activeTab === 'debts' && (
          <div className="p-4 space-y-4 animate-in fade-in">
            <h2 className="font-black text-amber-900 uppercase tracking-widest ml-1">Tagihan</h2>
            {debts.map((debt, idx) => (
              <div key={idx} className="bg-white p-6 rounded-[2rem] border border-amber-100 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                   <div className="flex items-center gap-3"><div className="p-3 bg-red-100 text-red-600 rounded-2xl"><CreditCard size={22}/></div><div><p className="font-bold text-amber-950">{debt.name}</p><p className="text-[10px] text-amber-600 uppercase font-black">Sisa Hutang</p></div></div>
                   <p className="text-lg font-black text-red-600">{formatIDR(debt.amount)}</p>
                </div>
                {debt.amount > 0 && (
                  <button onClick={() => openPayDebt(debt)} className="w-full bg-slate-900 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-all active:scale-95">
                    <Banknote size={18} className="text-amber-500" /> Bayar Tagihan
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] bg-white/60 backdrop-blur-2xl border border-white/40 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] px-8 py-4 flex justify-between items-center z-50">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'dashboard' ? 'text-amber-600 scale-110' : 'text-amber-300'}`}><Wallet size={24}/></button>
        <button onClick={() => setActiveTab('transactions')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'transactions' ? 'text-amber-600 scale-110' : 'text-amber-300'}`}><History size={24}/></button>
        <button onClick={() => setActiveTab('analysis')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'analysis' ? 'text-amber-600 scale-110' : 'text-amber-300'}`}><BarChart3 size={24}/></button>
        <button onClick={() => setActiveTab('debts')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'debts' ? 'text-amber-600 scale-110' : 'text-amber-300'}`}><CreditCard size={24}/></button>
      </nav>

      {/* MODAL TRANSAKSI */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={closeModal} />
          <div className="relative w-full max-w-sm bg-amber-50 rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-300 border-t-2 border-amber-200">
            <div className="flex justify-between items-center mb-6">
              {/* Judul Modal Dinamis */}
              <h3 className="text-2xl font-black text-amber-900 uppercase tracking-tighter italic">
                {editingTxId ? 'Edit Transaksi' : (newTx.type === 'in' ? 'Pemasukan' : newTx.type === 'out' ? 'Pengeluaran' : 'Pindah Saldo')}
              </h3>
              <button onClick={closeModal} className="p-3 bg-white text-amber-900 rounded-full shadow-sm"><X size={20} /></button>
            </div>
            <form onSubmit={handleTransaction} className="space-y-5">
              <div className="flex gap-2 p-1.5 bg-amber-100/50 rounded-2xl border border-amber-100">
                <button type="button" onClick={() => setNewTx({...newTx, fromAccountId: 1})} className={`flex-1 py-3 rounded-[1.25rem] font-black uppercase text-[10px] tracking-widest transition-all ${newTx.fromAccountId === 1 ? 'bg-slate-900 text-white' : 'text-amber-700/50'}`}>Bank</button>
                <button type="button" onClick={() => setNewTx({...newTx, fromAccountId: 2})} className={`flex-1 py-3 rounded-[1.25rem] font-black uppercase text-[10px] tracking-widest transition-all ${newTx.fromAccountId === 2 ? 'bg-slate-900 text-white' : 'text-amber-700/50'}`}>Kas</button>
              </div>
              <div className="bg-white p-5 rounded-[2rem] border border-amber-100 space-y-4 shadow-sm">
                <div><label className="text-[10px] font-black text-amber-800/30 uppercase tracking-widest">Keterangan</label><input type="text" className="w-full bg-transparent border-none p-0 mt-1 outline-none font-bold text-amber-950 focus:ring-0" placeholder="Beli apa?" value={newTx.desc} onChange={e => setNewTx({...newTx, desc: e.target.value})} /></div>
                {newTx.type !== 'transfer' && (
                  <div>
                    <label className="text-[10px] font-black text-amber-800/30 uppercase tracking-widest">Kategori Anggaran</label>
                    <select className="w-full bg-transparent border-none p-0 mt-1 outline-none font-bold text-amber-950 focus:ring-0" value={newTx.category} onChange={e => setNewTx({...newTx, category: e.target.value})}>
                      {baseBudget.map(b => <option key={b.category} value={b.category}>{b.category}</option>)}
                      <option value="Lain-lain">Lain-lain</option>
                    </select>
                  </div>
                )}
                <div><label className="text-[10px] font-black text-amber-800/30 uppercase tracking-widest">Jumlah Uang</label><div className="relative mt-1"><span className="absolute left-0 top-0 font-black text-amber-300 italic">Rp</span><input type="text" inputMode="numeric" required className="w-full bg-transparent border-none p-0 pl-8 outline-none font-black text-3xl text-amber-950 focus:ring-0" placeholder="0" value={newTx.amount} onChange={e => setNewTx({...newTx, amount: e.target.value})} /></div></div>
              </div>
              <div className="flex gap-2 mt-4 pb-4">
                {editingTxId && <button type="button" onClick={async () => { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', editingTxId)); closeModal(); }} className="p-5 bg-red-100 text-red-600 rounded-[1.5rem] font-bold active:scale-95 transition-all"><Trash2 size={24} /></button>}
                <button type="submit" className="flex-1 bg-slate-900 text-white py-5 rounded-[2rem] font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={20} className="text-amber-500" /> {editingTxId ? 'Simpan' : 'Rekam'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-sm h-[80vh] overflow-y-auto bg-amber-50 rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl p-8 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center mb-8 sticky top-0 bg-amber-50/90 backdrop-blur-sm pb-4 border-b border-amber-100 z-10">
              <h3 className="text-2xl font-black text-amber-900 uppercase tracking-tighter">Pengaturan</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="p-3 bg-white text-amber-900 rounded-full shadow-sm"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateSettings} className="space-y-10 pb-20">
              <section className="space-y-4">
                <h4 className="text-xs font-black text-amber-700 uppercase tracking-widest border-l-4 border-amber-500 pl-3">Saldo Dasar</h4>
                <div className="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm"><label className="text-[10px] font-black text-amber-800/30 uppercase tracking-widest">Saldo Bank Awal</label><input type="number" className="w-full bg-transparent border-none p-0 mt-1 outline-none font-black text-xl text-amber-950" value={editData.bankBalance} onChange={e => setEditData({...editData, bankBalance: e.target.value})} /></div>
                <div className="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm"><label className="text-[10px] font-black text-amber-800/30 uppercase tracking-widest">Saldo Kas Awal</label><input type="number" className="w-full bg-transparent border-none p-0 mt-1 outline-none font-black text-xl text-amber-950" value={editData.cashBalance} onChange={e => setEditData({...editData, cashBalance: e.target.value})} /></div>
              </section>
              <section className="space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-xs font-black text-amber-700 uppercase tracking-widest border-l-4 border-amber-500 pl-3">Kategori Anggaran</h4><button type="button" onClick={addCategory} className="text-blue-600 font-black text-[10px] uppercase border border-blue-100 px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-all">+ Tambah</button></div>
                <div className="space-y-4">
                  {editData.budgets.map((b, i) => (
                    <div key={i} className="bg-white p-4 rounded-2xl border border-amber-100 relative group">
                      <button type="button" onClick={() => deleteCategory(i)} className="absolute -top-2 -right-2 bg-red-100 text-red-600 p-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={12}/></button>
                      <input type="text" className="w-full bg-amber-50/50 border-none rounded-lg px-2 py-1 outline-none font-bold text-amber-950 text-xs mb-2" value={b.category} onChange={e => updateCategory(i, 'category', e.target.value)} />
                      <input type="number" className="w-full bg-amber-50/50 border-none rounded-lg px-2 py-1 outline-none font-black text-amber-950 text-xs" value={b.planned} onChange={e => updateCategory(i, 'planned', e.target.value)} />
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-xs font-black text-red-700 uppercase tracking-widest border-l-4 border-red-500 pl-3">Manajemen Tagihan</h4><button type="button" onClick={addDebt} className="text-blue-600 font-black text-[10px] uppercase border border-blue-100 px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-all">+ Tambah</button></div>
                <div className="space-y-4">
                  {editData.debts.map((d, i) => (
                    <div key={i} className="bg-white p-4 rounded-2xl border border-amber-100 relative group">
                      <button type="button" onClick={() => deleteDebt(i)} className="absolute -top-2 -right-2 bg-red-100 text-red-600 p-2 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={12}/></button>
                      <input type="text" className="w-full bg-amber-50/50 border-none rounded-lg px-2 py-1 outline-none font-bold text-amber-950 text-sm mb-2" value={d.name} onChange={e => updateDebtField(i, 'name', e.target.value)} />
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" className="w-full bg-amber-50/50 border-none rounded-lg px-2 py-1 outline-none font-black text-red-600 text-xs" value={d.amount} onChange={e => updateDebtField(i, 'amount', e.target.value)} placeholder="Sisa Hutang" />
                        <input type="number" className="w-full bg-amber-50/50 border-none rounded-lg px-2 py-1 outline-none font-black text-amber-950 text-xs" value={d.limit} onChange={e => updateDebtField(i, 'limit', e.target.value)} placeholder="Limit" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <button type="submit" className="w-full bg-slate-900 text-white py-5 rounded-[2rem] font-black uppercase tracking-widest sticky bottom-0 shadow-2xl active:scale-95 transition-all">Simpan Perubahan</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;