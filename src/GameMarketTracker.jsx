import React, { useState, useEffect } from 'react';
import { Search, TrendingDown, TrendingUp, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line } from 'recharts';
import { supabase } from './supabaseClient';

// Временные диапазоны в UI
const timeRanges = [
  { label: '1ч', value: '1h' },
  { label: '2ч', value: '2h' },
  { label: '3ч', value: '3h' },
  { label: '6ч', value: '6h' },
  { label: '12ч', value: '12h' },
  { label: '24ч', value: '24h' },
  { label: '3д', value: '3d' },
  { label: '7д', value: '7d' },
  { label: '14д', value: '14d' },
  { label: '30д', value: '30d' },
];

const RANGE_CONFIG = {
  '1h': { durationMs: 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
  '2h': { durationMs: 2 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
  '3h': { durationMs: 3 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  '6h': { durationMs: 6 * 60 * 60 * 1000, bucketMs: 30 * 60 * 1000 },
  '12h': { durationMs: 12 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  '24h': { durationMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  '3d': { durationMs: 3 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
  '7d': { durationMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  '14d': { durationMs: 14 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
  '30d': { durationMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000 },
};

// Вспомогательные функции
function groupTradesByItem(trades) {
  const map = {};
  for (const t of trades) {
    if (!t.item_name) continue;
    const key = t.item_name;
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }
  return map;
}

function formatLabel(date, rangeKey) {
  if (rangeKey === '7d' || rangeKey === '14d' || rangeKey === '30d') {
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function buildHistoryForRange(trades, rangeKey) {
  const config = RANGE_CONFIG[rangeKey];
  if (!config) return [];
  
  const { durationMs, bucketMs } = config;
  const now = Date.now();
  const startTime = now - durationMs;
  const bucketCount = Math.ceil(durationMs / bucketMs);
  
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    sumPriceQty: 0,
    sumQty: 0,
    minPrice: Infinity,
    maxPrice: -Infinity,
    volume: 0,
    start: new Date(startTime + i * bucketMs),
  }));

  for (const trade of trades) {
    const ts = new Date(trade.created_at).getTime();
    if (ts < startTime || ts > now || !trade.price || !trade.quantity) continue;
    
    const idx = Math.floor((ts - startTime) / bucketMs);
    if (idx < 0 || idx >= bucketCount) continue;
    
    const b = buckets[idx];
    const tradeValue = trade.price * trade.quantity;
    b.sumPriceQty += tradeValue;
    b.sumQty += trade.quantity;
    b.volume += trade.quantity;
    if (trade.price < b.minPrice) b.minPrice = trade.price;
    if (trade.price > b.maxPrice) b.maxPrice = trade.price;
  }

  return buckets
    .filter((b) => b.sumQty > 0)
    .map((b) => ({
      time: formatLabel(b.start, rangeKey),
      avgPrice: parseFloat((b.sumPriceQty / b.sumQty).toFixed(2)),
      minPrice: parseFloat(b.minPrice.toFixed(2)),
      maxPrice: parseFloat(b.maxPrice.toFixed(2)),
      volume: b.volume,
    }));
}

function calcPriceChange(points) {
  if (!points || points.length < 2) return 0;
  const first = points[0].avgPrice;
  const last = points[points.length - 1].avgPrice;
  if (!first) return 0;
  return ((last - first) / first) * 100;
}

function buildItemsFromTrades(trades) {
  const byItem = groupTradesByItem(trades);
  return Object.entries(byItem).map(([itemName, itemTrades]) => {
    const sorted = [...itemTrades].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const last = sorted[sorted.length - 1];

    const history1h = buildHistoryForRange(itemTrades, '1h');
    const history24h = buildHistoryForRange(itemTrades, '24h');
    const history7d = buildHistoryForRange(itemTrades, '7d');
    
    const priceChange = calcPriceChange(history24h);
    const totalQuantity = itemTrades.reduce((sum, t) => sum + (t.quantity || 0), 0);
    const minPrice = itemTrades.reduce(
      (min, t) => (t.price && t.price < min ? t.price : min),
      Infinity
    );

    const listings = sorted
      .slice(-5)
      .map((t) => ({
        seller: t.seller_name || 'Unknown',
        currency: t.currency || 'Gold',
        pricePerUnit: t.price || 0,
        quantity: t.quantity || 0,
      }))
      .reverse();

    return {
      id: itemName,
      name: itemName,
      totalQuantity,
      minPrice: Number.isFinite(minPrice) ? minPrice : 0,
      currency: last?.currency || 'Gold',
      priceChange,
      listings,
      tradeHistory: {
        '1h': history1h,
        '2h': buildHistoryForRange(itemTrades, '2h'),
        '3h': buildHistoryForRange(itemTrades, '3h'),
        '6h': buildHistoryForRange(itemTrades, '6h'),
        '12h': buildHistoryForRange(itemTrades, '12h'),
        '24h': history24h,
        '3d': buildHistoryForRange(itemTrades, '3d'),
        '7d': history7d,
        '14d': buildHistoryForRange(itemTrades, '14d'),
        '30d': buildHistoryForRange(itemTrades, '30d'),
      },
    };
  });
}

// Генерация демо-данных
function generateDemoData() {
  const demoTrades = [];
  const itemNames = ['Железный меч', 'Зелье здоровья', 'Кожаная броня', 'Магический кристалл', 'Эликсир маны'];
  const now = Date.now();
  
  for (let i = 0; i < 150; i++) {
    const hoursAgo = Math.random() * 168; // последние 7 дней
    demoTrades.push({
      item_name: itemNames[Math.floor(Math.random() * itemNames.length)],
      price: Math.floor(Math.random() * 500) + 50,
      quantity: Math.floor(Math.random() * 10) + 1,
      currency: 'Gold',
      seller_name: `Игрок${Math.floor(Math.random() * 100)}`,
      created_at: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
    });
  }
  
  return demoTrades;
}

// Tooltip для графика
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl">
        <p className="text-slate-300 font-medium mb-2">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="text-sm">
            {entry.name === 'avgPrice' && (
              <p className="text-blue-400">Средняя: {entry.value} Gold</p>
            )}
            {entry.name === 'minPrice' && (
              <p className="text-green-400">Минимум: {entry.value} Gold</p>
            )}
            {entry.name === 'maxPrice' && (
              <p className="text-red-400">Максимум: {entry.value} Gold</p>
            )}
            {entry.name === 'volume' && (
              <p className="text-purple-400">Продано: {entry.value} шт</p>
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Основной компонент
export default function GameMarketTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItem, setExpandedItem] = useState(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState('24h');
  const [viewMode, setViewMode] = useState('items');
  const [usingDemoData, setUsingDemoData] = useState(false);

  // Загрузка данных из Supabase с fallback на демо-данные
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      
      try {
        // Попытка загрузить данные из Supabase
        const { data, error } = await supabase
          .from('Trade')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) {
          console.warn('Ошибка Supabase:', error.message);
          throw error;
        }
        
        // Если получили хотя бы 1 строку - используем реальные данные
        if (data && data.length > 0) {
          console.log(`✅ Загружено ${data.length} записей из Supabase`);
          const itemsFromTrades = buildItemsFromTrades(data);
          setItems(itemsFromTrades);
          setUsingDemoData(false);
          return;
        }
        
        // Если база пустая
        console.log('⚠️ База данных пуста. Используются демо-данные.');
        const demoTrades = generateDemoData();
        const itemsFromTrades = buildItemsFromTrades(demoTrades);
        setItems(itemsFromTrades);
        setUsingDemoData(true);
        
      } catch (err) {
        console.error('❌ Ошибка подключения к Supabase:', err.message);
        console.log('🔄 Используются демо-данные для демонстрации интерфейса');
        
        // Fallback на демо-данные
        const demoTrades = generateDemoData();
        const itemsFromTrades = buildItemsFromTrades(demoTrades);
        setItems(itemsFromTrades);
        setUsingDemoData(true);
        
        // Показываем предупреждение только если это не просто пустая база
        if (!err.message.includes('pgrst116')) {
          setError('Не удалось подключиться к базе данных. Показаны демо-данные.');
        }
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleItem = (itemId) => {
    setExpandedItem(expandedItem === itemId ? null : itemId);
  };

  const getTradeData = (item) => {
    return item.tradeHistory[selectedTimeRange] || [];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-300 text-lg">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-2">
            Market Tracker
          </h1>
          <p className="text-slate-400">Отслеживайте цены и объёмы торговли</p>
          
          {/* Индикатор режима данных */}
          {usingDemoData && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <AlertCircle size={18} className="text-amber-400" />
              <span className="text-amber-300 text-sm">
                Используются демо-данные. Настройте Supabase для реальных данных.
              </span>
            </div>
          )}
          
          {error && !usingDemoData && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle size={18} className="text-red-400" />
              <span className="text-red-300 text-sm">{error}</span>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              placeholder="Поиск предмета..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-100 placeholder-slate-400"
            />
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4 mb-6">
          <label className="text-slate-300 font-medium mb-3 block">Временной диапазон:</label>
          <div className="flex flex-wrap gap-2">
            {timeRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => setSelectedTimeRange(range.value)}
                className={`px-3 py-1.5 rounded text-sm transition-all ${
                  selectedTimeRange === range.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50">
              <p className="text-lg">Предметы не найдены</p>
              {searchTerm && (
                <p className="text-sm mt-2">Попробуйте изменить поисковый запрос</p>
              )}
            </div>
          ) : (
            filteredItems.map((item) => {
              const tradeData = getTradeData(item);
              const lastPoint = tradeData.length > 0 ? tradeData[tradeData.length - 1] : null;

              return (
                <div
                  key={item.id}
                  className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden hover:border-blue-500/50 transition-colors"
                >
                  <div
                    onClick={() => toggleItem(item.id)}
                    className="p-4 cursor-pointer hover:bg-slate-700/20 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-slate-100 mb-1">{item.name}</h3>
                        <div className="flex gap-4 text-sm text-slate-400">
                          <span>На рынке: <span className="text-slate-200">{item.totalQuantity}</span></span>
                          <span>Мин. цена: <span className="text-slate-200">{item.minPrice} {item.currency}</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-1 ${
                          item.priceChange >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {item.priceChange < 0 ? <TrendingDown size={20} /> : <TrendingUp size={20} />}
                          <span className="font-semibold">{Math.abs(item.priceChange).toFixed(2)}%</span>
                        </div>
                        {expandedItem === item.id ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                      </div>
                    </div>
                  </div>

                  {expandedItem === item.id && (
                    <div className="border-t border-slate-700/50 p-6 space-y-6">
                      <div>
                        <h4 className="text-slate-300 font-semibold mb-4">
                          График цен и объёма торгов ({selectedTimeRange})
                        </h4>
                        {tradeData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={tradeData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                              <XAxis dataKey="time" stroke="#94a3b8" />
                              <YAxis yAxisId="left" stroke="#94a3b8" />
                              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" />
                              <Tooltip content={<CustomTooltip />} />
                              <Legend
                                formatter={(value) => {
                                  const labels = {
                                    avgPrice: 'Средняя цена',
                                    minPrice: 'Мин. цена',
                                    maxPrice: 'Макс. цена',
                                    volume: 'Объём продаж',
                                  };
                                  return labels[value] || value;
                                }}
                              />
                              <Bar yAxisId="right" dataKey="volume" fill="#8b5cf6" opacity={0.6} name="volume" />
                              <Line yAxisId="left" type="monotone" dataKey="avgPrice" stroke="#3b82f6" strokeWidth={2} name="avgPrice" />
                              <Line yAxisId="left" type="monotone" dataKey="minPrice" stroke="#10b981" strokeWidth={1} strokeDasharray="5 5" name="minPrice" />
                              <Line yAxisId="left" type="monotone" dataKey="maxPrice" stroke="#ef4444" strokeWidth={1} strokeDasharray="5 5" name="maxPrice" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="text-center py-8 text-slate-400">
                            Нет данных за выбранный период
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                          <div className="text-blue-400 text-sm mb-1">Средняя цена</div>
                          <div className="text-slate-100 font-semibold">
                            {lastPoint ? lastPoint.avgPrice.toFixed(2) : '—'} Gold
                          </div>
                        </div>
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                          <div className="text-green-400 text-sm mb-1">Мин. цена</div>
                          <div className="text-slate-100 font-semibold">
                            {lastPoint ? lastPoint.minPrice.toFixed(2) : '—'} Gold
                          </div>
                        </div>
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                          <div className="text-red-400 text-sm mb-1">Макс. цена</div>
                          <div className="text-slate-100 font-semibold">
                            {lastPoint ? lastPoint.maxPrice.toFixed(2) : '—'} Gold
                          </div>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                          <div className="text-purple-400 text-sm mb-1">Всего продано</div>
                          <div className="text-slate-100 font-semibold">
                            {tradeData.reduce((sum, d) => sum + d.volume, 0)} шт
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-slate-300 font-semibold mb-3">Текущие предложения на рынке</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="text-left py-2 px-3 text-slate-400 font-medium">Продавец</th>
                                <th className="text-left py-2 px-3 text-slate-400 font-medium">Валюта</th>
                                <th className="text-right py-2 px-3 text-slate-400 font-medium">Цена/шт</th>
                                <th className="text-right py-2 px-3 text-slate-400 font-medium">Количество</th>
                                <th className="text-right py-2 px-3 text-slate-400 font-medium">Всего</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.listings.map((listing, idx) => (
                                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                  <td className="py-2 px-3 text-slate-200">{listing.seller}</td>
                                  <td className="py-2 px-3 text-slate-300">{listing.currency}</td>
                                  <td className="py-2 px-3 text-right text-slate-200">{listing.pricePerUnit}</td>
                                  <td className="py-2 px-3 text-right text-slate-200">{listing.quantity}</td>
                                  <td className="py-2 px-3 text-right text-slate-100 font-semibold">
                                    {listing.pricePerUnit * listing.quantity}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}