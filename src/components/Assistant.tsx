import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Spinner } from '@astryxdesign/core/Spinner';
import { PaperPlaneRight, Robot } from '@phosphor-icons/react';
import { api, ApiError } from '../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">открыть карту</a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );

export function Assistant({
  slug, mode, examples, session, title, intro,
}: { slug: string; mode: 'client' | 'owner'; examples: string[]; session?: Session | null; title: string; intro: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const send = async (q: string) => {
    const content = q.trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user' as const, content }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const r = await api.ask(slug, mode, next.slice(-10), session);
      setMsgs([...next, { role: 'assistant', content: r.reply }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: (e as ApiError).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="assistant" aria-label={title}>
      <div className="assistant__head">
        <span className="assistant__avatar"><Robot size={22} weight="duotone" aria-hidden /></span>
        <div>
          <h2 className="assistant__title">{title}</h2>
          <p className="assistant__intro">{intro}</p>
        </div>
      </div>
      {msgs.length > 0 && (
        <div className="assistant__log" ref={listRef} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble bubble--${m.role}`}>{m.role === 'assistant' ? linkify(m.content) : m.content}</div>
          ))}
          {busy && <div className="bubble bubble--assistant"><Spinner size="sm" aria-label="Помощник отвечает" /></div>}
        </div>
      )}
      <div className="chips" role="list">
        {examples.map((e) => (
          <button key={e} type="button" role="listitem" className="chip" onClick={() => send(e)} disabled={busy}>{e}</button>
        ))}
      </div>
      <form className="assistant__form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <TextInput label="Ваш вопрос" isLabelHidden value={text} onChange={setText} placeholder="Спросите обычными словами…" enterKeyHint="send" size="lg" width="100%" />
        <Button type="submit" variant="primary" size="lg" label="Отправить" isIconOnly icon={<PaperPlaneRight size={20} weight="fill" />} isLoading={busy} />
      </form>
    </section>
  );
}
