import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { TabList, Tab } from '@astryxdesign/core/TabList';
import { SignOut, ArrowSquareOut } from '@phosphor-icons/react';
import type { StudioCtx } from '../StudioLayout';
import { supabase } from '../../lib/api';
import { BookingsTab } from './BookingsTab';
import { StudioTab, ServicesTab, PhotosTab } from './SettingsTabs';
import { Assistant } from '../../components/Assistant';

export function AdminPage() {
  const { studio } = useOutletContext<StudioCtx>();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const owner = useQuery({
    queryKey: ['is-owner', studio.tenant.id, session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data } = await supabase.from('tenant_owners').select('tenant_id').eq('tenant_id', studio.tenant.id).eq('user_id', session!.user.id).maybeSingle();
      return !!data;
    },
  });

  if (session === undefined || (session && owner.isLoading)) return <div className="page-center"><Spinner size="xl" aria-label="Загрузка" /></div>;
  if (!session) return <Login studioName={studio.tenant.name} />;
  if (!owner.data) {
    return (
      <div className="content content--page admin">
        <Banner status="error" title="Нет доступа к этой студии" description="Вы вошли под учётной записью другой студии." />
        <Button label="Выйти" onClick={() => supabase.auth.signOut()} />
      </div>
    );
  }
  return <Dashboard session={session} />;
}

function Login({ studioName }: { studioName: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message.includes('Invalid') ? 'Неверная почта или пароль' : 'Не удалось войти. Проверьте интернет.');
    setBusy(false);
  };
  return (
    <div className="page-center">
      <form className="login" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="eyebrow">{studioName}</p>
        <h1 className="page-title">Кабинет владельца</h1>
        <TextInput label="Почта" type="email" value={email} onChange={setEmail} autoComplete="username" size="lg" isRequired />
        <TextInput label="Пароль" type="password" value={password} onChange={setPassword} autoComplete="current-password" size="lg" isRequired />
        {err && <Banner status="error" title={err} />}
        <Button type="submit" variant="primary" size="lg" width="100%" label="Войти" isLoading={busy} />
      </form>
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const { studio } = useOutletContext<StudioCtx>();
  const [tab, setTab] = useState('bookings');
  return (
    <div className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">Кабинет</p>
          <h1 className="admin__title">{studio.tenant.name}</h1>
        </div>
        <div className="admin__bar-actions">
          <Link className="btn-ghost" to={`/s/${studio.tenant.slug}`} target="_blank"><ArrowSquareOut size={18} aria-hidden /> Сайт</Link>
          <Button variant="ghost" label="Выйти" icon={<SignOut size={18} />} onClick={() => supabase.auth.signOut()} />
        </div>
      </header>
      <div className="admin__tabs">
        <TabList value={tab} onChange={setTab} overflow="scroll" hasDivider role="tablist">
          <Tab value="bookings" label="Записи" />
          <Tab value="assistant" label="Помощник" />
          <Tab value="studio" label="Студия" />
          <Tab value="services" label="Услуги и боксы" />
          <Tab value="photos" label="Фото работ" />
        </TabList>
      </div>
      <div className="admin__body">
        {tab === 'bookings' && <BookingsTab session={session} />}
        {tab === 'assistant' && (
          <Assistant slug={studio.tenant.slug} mode="owner" session={session} title="Помощник владельца"
            intro="Отвечает по вашим записям и оплатам. Ничего не меняет сам."
            examples={['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?']} />
        )}
        {tab === 'studio' && <StudioTab />}
        {tab === 'services' && <ServicesTab />}
        {tab === 'photos' && <PhotosTab />}
      </div>
    </div>
  );
}
