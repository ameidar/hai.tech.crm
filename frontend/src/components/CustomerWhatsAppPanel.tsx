import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Send, RefreshCw, ExternalLink, Lock, FileText } from 'lucide-react';
import {
  useCustomerWhatsApp,
  useWaTemplates,
  useSendWaText,
  useSendWaTemplate,
  type WaTemplate,
} from '../hooks/useApi';

function templateBody(t: WaTemplate): string {
  const body = t.components?.find((c) => (c.type || '').toUpperCase() === 'BODY');
  return body?.text || '';
}

function countVars(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  const nums = matches.map((m) => parseInt(m.replace(/\D/g, ''), 10));
  return Math.max(0, ...nums);
}

function fillTemplate(text: string, vars: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => vars[parseInt(n, 10) - 1] || `{{${n}}}`);
}

export default function CustomerWhatsAppPanel({ customerId }: { customerId: string }) {
  const { data, isLoading, refetch, isRefetching } = useCustomerWhatsApp(customerId);
  const sendText = useSendWaText();
  const sendTemplate = useSendWaTemplate();

  const [text, setText] = useState('');
  const [mode, setMode] = useState<'text' | 'template'>('text');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [vars, setVars] = useState<string[]>([]);

  const conversation = data?.conversation || null;
  const windowOpen = data?.windowOpen ?? false;
  const phone = data?.normalizedPhone || null;

  // Outside the 24h service window (or no inbound yet) only templates may be sent.
  const templatesOnly = !windowOpen;

  // Templates are only needed when in template mode; fetch lazily by phone number id.
  const { data: templates } = useWaTemplates(conversation?.phoneNumberId || undefined);
  const approvedTemplates = useMemo(
    () => (templates || []).filter((t) => (t.status || '').toUpperCase() === 'APPROVED'),
    [templates]
  );

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [data?.messages?.length]);

  useEffect(() => {
    setMode(templatesOnly ? 'template' : 'text');
  }, [templatesOnly]);

  const currentTemplate = approvedTemplates.find((t) => t.name === selectedTemplate) || null;
  const currentBody = currentTemplate ? templateBody(currentTemplate) : '';
  const varCount = currentTemplate ? countVars(currentBody) : 0;

  useEffect(() => {
    setVars(Array(varCount).fill(''));
  }, [selectedTemplate, varCount]);

  if (isLoading) {
    return (
      <div className="lg:col-span-3 card">
        <div className="card-header"><h2 className="font-semibold">וואטסאפ</h2></div>
        <div className="p-8 text-center text-gray-400">טוען שיחה...</div>
      </div>
    );
  }

  if (!phone) {
    return (
      <div className="lg:col-span-3 card">
        <div className="card-header"><h2 className="font-semibold flex items-center gap-2"><MessageCircle size={18} className="text-green-600" />וואטסאפ</h2></div>
        <div className="p-8 text-center text-gray-400">אין מספר טלפון ללקוח — לא ניתן להציג שיחת וואטסאפ.</div>
      </div>
    );
  }

  const handleSendText = async () => {
    if (!conversation || !text.trim()) return;
    try {
      await sendText.mutateAsync({ conversationId: conversation.id, text: text.trim(), customerId });
      setText('');
    } catch {
      alert('שליחת ההודעה נכשלה');
    }
  };

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !currentTemplate) return;
    const previewText = fillTemplate(currentBody, vars);
    try {
      await sendTemplate.mutateAsync({
        customerId,
        conversationId: conversation?.id,
        phone: conversation ? undefined : phone,
        contactName: conversation ? undefined : data?.customer.name,
        templateName: selectedTemplate,
        language: currentTemplate.language || 'he',
        variables: varCount > 0 ? vars : undefined,
        previewText,
        fromPhoneNumberId: conversation?.phoneNumberId || undefined,
      });
      setSelectedTemplate('');
      setVars([]);
    } catch {
      alert('שליחת התבנית נכשלה');
    }
  };

  return (
    <div className="lg:col-span-3 card flex flex-col">
      <div className="card-header flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <MessageCircle size={18} className="text-green-600" />
          וואטסאפ
          {conversation && (
            <span className="text-xs font-normal text-gray-400" dir="ltr">{conversation.businessPhone || ''}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="רענן"
          >
            <RefreshCw size={16} className={isRefetching ? 'animate-spin' : ''} />
          </button>
          <Link to="/whatsapp" className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors" title="פתח בתיבת וואטסאפ">
            <ExternalLink size={16} />
          </Link>
        </div>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-2" style={{ maxHeight: 360, minHeight: 200 }}>
        {!conversation || data!.messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            אין עדיין שיחה עם הלקוח. אפשר לפתוח שיחה בשליחת תבנית מאושרת למטה.
          </div>
        ) : (
          data!.messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                  m.direction === 'outbound'
                    ? 'bg-green-100 text-gray-800 rounded-br-sm'
                    : 'bg-white border text-gray-800 rounded-bl-sm'
                }`}
              >
                <div>{m.content}</div>
                <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1 justify-end">
                  {m.isAiGenerated && <span title="נשלח ע״י הבוט">🤖</span>}
                  {new Date(m.createdAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="p-3 border-t bg-white">
        {templatesOnly && (
          <div className="mb-2 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Lock size={14} />
            {conversation
              ? 'חלון 24 השעות נסגר — Meta מאפשרת לשלוח רק תבנית מאושרת עד שהלקוח יגיב.'
              : 'הלקוח עוד לא כתב לנו — ניתן לפתוח שיחה רק באמצעות תבנית מאושרת.'}
          </div>
        )}

        {/* Mode toggle (only when free text is allowed) */}
        {!templatesOnly && (
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setMode('text')}
              className={`text-xs px-3 py-1 rounded-full font-medium ${mode === 'text' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
            >
              הודעה חופשית
            </button>
            <button
              onClick={() => setMode('template')}
              className={`text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1 ${mode === 'template' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
            >
              <FileText size={12} /> תבנית
            </button>
          </div>
        )}

        {mode === 'text' && !templatesOnly ? (
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              rows={2}
              placeholder="כתוב הודעה..."
              className="form-input flex-1 resize-none"
            />
            <button
              onClick={handleSendText}
              disabled={!text.trim() || sendText.isPending}
              className="btn btn-primary"
              title="שלח"
            >
              <Send size={16} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="form-input w-full"
            >
              <option value="">בחר תבנית מאושרת...</option>
              {approvedTemplates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>

            {currentTemplate && (
              <>
                {varCount > 0 && (
                  <div className="space-y-2">
                    {Array.from({ length: varCount }).map((_, i) => (
                      <input
                        key={i}
                        value={vars[i] || ''}
                        onChange={(e) => {
                          const next = [...vars];
                          next[i] = e.target.value;
                          setVars(next);
                        }}
                        placeholder={`ערך למשתנה {{${i + 1}}}`}
                        className="form-input w-full"
                      />
                    ))}
                  </div>
                )}
                <div className="text-xs text-gray-500 bg-gray-50 border rounded-lg p-2 whitespace-pre-wrap">
                  {fillTemplate(currentBody, vars)}
                </div>
              </>
            )}

            <button
              onClick={handleSendTemplate}
              disabled={!selectedTemplate || sendTemplate.isPending}
              className="btn btn-primary w-full"
            >
              <Send size={16} />
              שלח תבנית
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
