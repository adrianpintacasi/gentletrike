import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { Sparkles, TrendingUp, AlertTriangle, MessageSquare, Send, Zap } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const AiInsightsPage: React.FC = () => {
  const [forecast, setForecast] = useState<adminApi.DemandForecastItem[]>([]);
  const [riskScores, setRiskScores] = useState<adminApi.DriverRiskItem[]>([]);

  // Auto Categorizer Widget State
  const [reportInput, setReportInput] = useState('');
  const [categorizeResult, setCategorizeResult] = useState<{
    suggestedCategory: string;
    urgency: string;
    note: string;
  } | null>(null);
  const [isCategorizing, setIsCategorizing] = useState(false);

  // Chatbot State
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'bot'; text: string }[]>([
    {
      sender: 'bot',
      text: 'Maayong adlaw! I am the TMO Data Assistant. Ask me anything like "How many cancelled rides this week?" or "Show online drivers".',
    },
  ]);
  const [isAsking, setIsAsking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.getDemandForecast(), adminApi.getDriverRiskScores()])
      .then(([f, r]) => {
        setForecast(f.forecast);
        setRiskScores(r);
      })
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, []);

  const handleTestCategorize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportInput.trim()) return;

    setIsCategorizing(true);
    try {
      const res = await adminApi.categorizeReportText(reportInput);
      setCategorizeResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCategorizing(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isAsking) return;

    const q = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { sender: 'user', text: q }]);
    setIsAsking(true);

    try {
      const reply = await adminApi.askAdminChatbot(q);
      setChatMessages((prev) => [...prev, { sender: 'bot', text: reply }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'bot', text: `Error: ${err.message || 'Failed to query assistant'}` },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading AI intelligence models...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* AI Demand Forecasting Chart */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">Ride Demand Forecasting Model</h3>
              <p className="text-xs text-gray-500">Predicted hailing demand per hour (Time-Series Moving Average)</p>
            </div>
          </div>
          <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold">
            Moving-Average Baseline Model
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={forecast}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="predictedDemand" stroke="#F59E0B" strokeWidth={3} name="Predicted Demand" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Driver Risk Scoring & Auto Categorizer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Driver Risk Scoring */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                Driver Risk Scoring Engine
              </h3>
              <p className="text-xs text-gray-500">Weighted risk index derived from complaints, declines & cancels</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-4 py-3">Driver Name</th>
                  <th className="px-4 py-3">Unit #</th>
                  <th className="px-4 py-3">Risk Score</th>
                  <th className="px-4 py-3">Risk Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {riskScores.map((score) => (
                  <tr key={score.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-900">{score.name}</td>
                    <td className="px-4 py-3 font-medium text-gray-600">{score.unitNumber}</td>
                    <td className="px-4 py-3 font-bold text-purple-700">{score.riskScore} / 100</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border uppercase tracking-wider ${
                          score.riskBadge === 'High'
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : score.riskBadge === 'Medium'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {score.riskBadge}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Complaint Auto-Categorizer Tool */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-600" />
              <h3 className="text-base font-black text-gray-900">Complaint Auto-Categorizer</h3>
            </div>
            <p className="text-xs text-gray-500">Test the NLP rule-based suggestion engine for incoming reports</p>
          </div>

          <form onSubmit={handleTestCategorize} className="space-y-3">
            <textarea
              rows={3}
              value={reportInput}
              onChange={(e) => setReportInput(e.target.value)}
              placeholder="e.g. Kuya demanded 100 pesos for a short trip to Boulevard..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-purple-500 font-medium"
            />
            <button
              type="submit"
              disabled={isCategorizing}
              className="w-full py-2 bg-purple-600 text-white font-bold text-xs rounded-xl shadow-xs hover:bg-purple-700 transition"
            >
              {isCategorizing ? 'Analyzing Text...' : 'Analyze Complaint Text'}
            </button>
          </form>

          {categorizeResult && (
            <div className="p-4 bg-purple-50 rounded-xl border border-purple-200 text-xs space-y-1">
              <p className="font-bold text-purple-900">
                Suggested Category: <span className="capitalize text-purple-700">{categorizeResult.suggestedCategory.replace('_', ' ')}</span>
              </p>
              <p className="font-bold text-purple-900">
                Urgency Flag: <span className="uppercase text-red-600">{categorizeResult.urgency}</span>
              </p>
              <p className="text-[11px] text-gray-500 font-medium pt-1">{categorizeResult.note}</p>
            </div>
          )}
        </div>
      </div>

      {/* Admin Assistant Chatbot */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-base font-black text-gray-900">TMO Administrative AI Assistant</h3>
            <p className="text-xs text-gray-500">Query live database records using natural language queries</p>
          </div>
        </div>

        <div className="h-60 bg-gray-50 border border-gray-200 rounded-2xl p-4 overflow-y-auto space-y-3">
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-md p-3 rounded-2xl text-xs font-medium ${
                  msg.sender === 'user' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-900 shadow-xs'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSendChat} className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask a question (e.g. How many cancelled rides this week?)..."
            className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            type="submit"
            disabled={isAsking}
            className="px-4 py-2.5 bg-gray-900 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 hover:bg-gray-800 transition"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
