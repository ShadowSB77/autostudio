import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import { Selector } from '@astryxdesign/core/Selector';
import { Banner } from '@astryxdesign/core/Banner';
import { Plus, Trash, UploadSimple, FloppyDisk } from '@phosphor-icons/react';
import { z } from 'zod';
import type { StudioCtx } from '../StudioLayout';
import { supabase, type Feature, type GalleryItem, type Service, type Bay } from '../../lib/api';
import { DAY_KEYS, DAY_LABELS, type Schedule } from '../../shared/schedule';
import { featureSchema } from '../../shared/tenantConfig';
import { resizeImage } from '../../lib/util';
import { FeatureIcon, featureIcons } from '../../components/Hero';

function useRefresh() {
  const qc = useQueryClient();
  const { studio } = useOutletContext<StudioCtx>();
  return () => {
    qc.invalidateQueries({ queryKey: ['studio', studio.tenant.slug] });
    qc.invalidateQueries({ queryKey: ['busy', studio.tenant.id] });
  };
}

async function uploadImage(tenantId: string, folder: string, file: File, maxW = 1800) {
  const blob = await resizeImage(file, maxW);
  const path = `${tenantId}/${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('media').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

function FilePick({ label, onFile, variant = 'secondary' }: { label: string; onFile: (f: File) => Promise<void>; variant?: 'secondary' | 'primary' | 'ghost' }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        try { await onFile(f); } finally { setBusy(false); }
      }} />
      <Button variant={variant} label={label} icon={<UploadSimple size={18} />} isLoading={busy} onClick={() => ref.current?.click()} />
    </>
  );
}

const hex = /^#[0-9a-fA-F]{6}$/;
const studioSchema = z.object({
  name: z.string().trim().min(2, 'Название: минимум 2 символа').max(60),
  tagline: z.string().max(160),
  address: z.string().trim().min(3, 'Укажите адрес'),
  map_url: z.string().url('Ссылка на карту должна начинаться с https://').or(z.literal('')),
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/, 'Телефон в формате +7 900 000-00-00'),
  accent: z.string().regex(hex, 'Цвет в формате #D4AF37'),
  prep_minutes: z.number().int().min(0).max(600),
  cancel_hours: z.number().int().min(0).max(168),
  cancel_policy: z.string().max(300),
  features: z.array(featureSchema).length(3),
});

export function StudioTab() {
  const { studio } = useOutletContext<StudioCtx>();
  const t = studio.tenant;
  const refresh = useRefresh();
  const [f, setF] = useState({
    name: t.name, tagline: t.tagline, address: t.address, map_url: t.map_url, phone: t.phone, accent: t.accent,
    prep_minutes: t.prep_minutes, cancel_hours: t.cancel_hours, cancel_policy: t.cancel_policy,
    features: (t.features?.length === 3 ? t.features : [...(t.features ?? []), ...Array(3).fill({ icon: 'star', value: '', label: '' })].slice(0, 3)) as Feature[],
  });
  const [schedule, setSchedule] = useState<Schedule>(t.schedule);
  const [daysOff, setDaysOff] = useState<string[]>(studio.daysOff);
  const [newOff, setNewOff] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setMsg(null);
    const p = studioSchema.safeParse(f);
    if (!p.success) { setMsg({ ok: false, text: p.error.issues[0].message }); return; }
    for (const k of DAY_KEYS) for (const [a, b] of schedule[k] ?? []) if (!(a < b)) { setMsg({ ok: false, text: `${DAY_LABELS[k]}: время открытия должно быть раньше закрытия` }); return; }
    const { error } = await supabase.from('tenants').update({ ...p.data, schedule }).eq('id', t.id);
    if (error) { setMsg({ ok: false, text: 'Не удалось сохранить' }); return; }
    await supabase.from('days_off').delete().eq('tenant_id', t.id);
    if (daysOff.length) await supabase.from('days_off').insert(daysOff.map((day) => ({ tenant_id: t.id, day })));
    setMsg({ ok: true, text: 'Сохранено. Изменения уже видны клиентам.' });
    refresh();
  };

  const setDay = (k: (typeof DAY_KEYS)[number], v: [string, string][]) => setSchedule({ ...schedule, [k]: v });

  return (
    <div className="settings">
      <section className="settings__block">
        <h2 className="settings__title">Логотип и главное фото</h2>
        <div className="media-row">
          <div className="media-thumb media-thumb--logo">{t.logo_url ? <img src={t.logo_url} alt="Логотип" /> : <span>нет</span>}</div>
          <FilePick label="Заменить логотип" onFile={async (file) => {
            const url = await uploadImage(t.id, 'brand', file, 600);
            await supabase.from('tenants').update({ logo_url: url }).eq('id', t.id);
            refresh();
          }} />
        </div>
        <div className="media-row">
          <div className="media-thumb">{t.hero_url ? <img src={t.hero_url} alt="Главное фото" /> : <span>нет</span>}</div>
          <FilePick label="Заменить главное фото" onFile={async (file) => {
            const url = await uploadImage(t.id, 'brand', file, 2200);
            await supabase.from('tenants').update({ hero_url: url }).eq('id', t.id);
            refresh();
          }} />
        </div>
      </section>

      <section className="settings__block">
        <h2 className="settings__title">Основное</h2>
        <TextInput label="Название" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <TextInput label="Короткое описание" value={f.tagline} onChange={(v) => setF({ ...f, tagline: v })} />
        <TextInput label="Адрес" value={f.address} onChange={(v) => setF({ ...f, address: v })} />
        <TextInput label="Ссылка на карту" type="url" value={f.map_url} onChange={(v) => setF({ ...f, map_url: v })} placeholder="https://yandex.ru/maps/…" />
        <TextInput label="Телефон" type="tel" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        <div className="color-row">
          <input type="color" aria-label="Акцентный цвет" value={hex.test(f.accent) ? f.accent : '#D4AF37'} onChange={(e) => setF({ ...f, accent: e.target.value.toUpperCase() })} />
          <TextInput label="Акцентный цвет" value={f.accent} onChange={(v) => setF({ ...f, accent: v })} />
        </div>
      </section>

      <section className="settings__block">
        <h2 className="settings__title">Три карточки на главной</h2>
        {f.features.map((ft, i) => (
          <div key={i} className="feature-edit">
            <span className="dash__icon"><FeatureIcon icon={ft.icon} /></span>
            <Selector label="Иконка" value={ft.icon} onChange={(v) => { const n = [...f.features]; n[i] = { ...ft, icon: v as Feature['icon'] }; setF({ ...f, features: n }); }}
              options={Object.keys(featureIcons).map((k) => ({ value: k, label: k }))} />
            <TextInput label="Значение" value={ft.value} onChange={(v) => { const n = [...f.features]; n[i] = { ...ft, value: v }; setF({ ...f, features: n }); }} placeholder="3 года" />
            <TextInput label="Подпись" value={ft.label} onChange={(v) => { const n = [...f.features]; n[i] = { ...ft, label: v }; setF({ ...f, features: n }); }} placeholder="гарантия на керамику" />
          </div>
        ))}
      </section>

      <section className="settings__block">
        <h2 className="settings__title">Часы работы</h2>
        {DAY_KEYS.map((k) => {
          const r = schedule[k] ?? [];
          const open = r.length > 0;
          return (
            <div key={k} className="hours-edit">
              <span className="hours-edit__day">{DAY_LABELS[k]}</span>
              <Switch label="Работаем" size="sm" value={open} onChange={(v) => setDay(k, v ? [['09:00', '20:00']] : [])} />
              {open && (
                <>
                  <input type="time" aria-label={`${DAY_LABELS[k]}: открытие`} value={r[0][0]} onChange={(e) => setDay(k, [[e.target.value, r[0][1]]])} />
                  <span>—</span>
                  <input type="time" aria-label={`${DAY_LABELS[k]}: закрытие`} value={r[0][1]} onChange={(e) => setDay(k, [[r[0][0], e.target.value]])} />
                </>
              )}
            </div>
          );
        })}
        <h3 className="settings__sub">Выходные дни</h3>
        <div className="offdays">
          {daysOff.sort().map((d) => (
            <button key={d} type="button" className="chip" onClick={() => setDaysOff(daysOff.filter((x) => x !== d))} aria-label={`Убрать ${d}`}>{d} ✕</button>
          ))}
        </div>
        <div className="inline-add">
          <input type="date" aria-label="Дата выходного" value={newOff} onChange={(e) => setNewOff(e.target.value)} />
          <Button variant="secondary" label="Добавить выходной" isDisabled={!newOff} onClick={() => { if (!daysOff.includes(newOff)) setDaysOff([...daysOff, newOff]); setNewOff(''); }} />
        </div>
      </section>

      <section className="settings__block">
        <h2 className="settings__title">Правила</h2>
        <NumberInput label="Подготовка бокса между машинами, мин" value={f.prep_minutes} onChange={(v) => setF({ ...f, prep_minutes: v })} min={0} max={600} step={5} />
        <NumberInput label="Онлайн-отмена не позднее, ч до начала" value={f.cancel_hours} onChange={(v) => setF({ ...f, cancel_hours: v })} min={0} max={168} />
        <TextArea label="Правила отмены (видят клиенты)" value={f.cancel_policy} onChange={(v) => setF({ ...f, cancel_policy: v })} rows={2} />
      </section>
      <div className="sticky-save">
        {msg && <Banner status={msg.ok ? 'success' : 'error'} title={msg.text} />}
        <Button variant="primary" size="lg" width="100%" label="Сохранить изменения" icon={<FloppyDisk size={18} />} clickAction={save} />
      </div>
      <PasswordBlock />
    </div>
  );
}

function PasswordBlock() {
  const [p, setP] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="settings__block">
      <h2 className="settings__title">Пароль от кабинета</h2>
      <TextInput label="Новый пароль" type="password" value={p} onChange={setP} autoComplete="new-password" description="Минимум 8 символов" />
      {msg && <p className="hint">{msg}</p>}
      <Button variant="secondary" label="Сменить пароль" isDisabled={p.length < 8} clickAction={async () => {
        const { error } = await supabase.auth.updateUser({ password: p });
        setMsg(error ? 'Не удалось сменить пароль' : 'Пароль изменён');
        setP('');
      }} />
    </section>
  );
}

const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Название услуги: минимум 2 символа'),
  description: z.string().max(400),
  price: z.number().min(0, 'Цена не может быть отрицательной'),
  duration_minutes: z.number().int().min(10, 'Длительность от 10 минут').max(10080),
});

export function ServicesTab() {
  const { studio } = useOutletContext<StudioCtx>();
  const refresh = useRefresh();
  return (
    <div className="settings">
      <section className="settings__block">
        <h2 className="settings__title">Услуги</h2>
        <p className="hint">Длительность — рабочее время. Если работа не помещается в день, она продолжится на следующий рабочий день, бокс будет занят всё это время.</p>
        {studio.services.map((s) => <ServiceRow key={s.id} s={s} onSaved={refresh} />)}
        <Button variant="secondary" label="Добавить услугу" icon={<Plus size={18} />} clickAction={async () => {
          await supabase.from('services').insert({ tenant_id: studio.tenant.id, name: 'Новая услуга', price: 0, duration_minutes: 60, sort: studio.services.length, active: false });
          refresh();
        }} />
      </section>
      <section className="settings__block">
        <h2 className="settings__title">Боксы</h2>
        {studio.bays.map((b) => <BayRow key={b.id} b={b} onSaved={refresh} />)}
        <Button variant="secondary" label="Добавить бокс" icon={<Plus size={18} />} clickAction={async () => {
          await supabase.from('bays').insert({ tenant_id: studio.tenant.id, name: `Бокс ${studio.bays.length + 1}`, sort: studio.bays.length });
          refresh();
        }} />
      </section>
    </div>
  );
}

function ServiceRow({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const [v, setV] = useState({ name: s.name, description: s.description, price: Number(s.price), price_from: s.price_from, duration_minutes: s.duration_minutes, active: s.active });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify({ name: s.name, description: s.description, price: Number(s.price), price_from: s.price_from, duration_minutes: s.duration_minutes, active: s.active });
  return (
    <div className="row-edit">
      <TextInput label="Название" value={v.name} onChange={(x) => { setV({ ...v, name: x }); setSaved(false); }} />
      <div className="row-edit__pair">
        <NumberInput label="Цена, ₽" value={v.price} onChange={(x) => setV({ ...v, price: x })} min={0} step={500} />
        <NumberInput label="Длительность, мин" value={v.duration_minutes} onChange={(x) => setV({ ...v, duration_minutes: x })} min={10} step={30} />
      </div>
      <TextArea label="Описание" value={v.description} onChange={(x) => setV({ ...v, description: x })} rows={2} />
      <div className="row-edit__switches">
        <Switch label="Цена «от»" size="sm" value={v.price_from} onChange={(x) => setV({ ...v, price_from: x })} />
        <Switch label="Показывать клиентам" size="sm" value={v.active} onChange={(x) => setV({ ...v, active: x })} />
      </div>
      {err && <Banner status="error" title={err} />}
      <Button variant={dirty ? 'primary' : 'secondary'} label={saved && !dirty ? 'Сохранено' : 'Сохранить услугу'} isDisabled={!dirty} clickAction={async () => {
        const p = serviceSchema.safeParse(v);
        if (!p.success) { setErr(p.error.issues[0].message); return; }
        const { error } = await supabase.from('services').update({ ...v, ...p.data }).eq('id', s.id);
        setErr(error ? 'Не удалось сохранить' : null);
        if (!error) { setSaved(true); onSaved(); }
      }} />
    </div>
  );
}

function BayRow({ b, onSaved }: { b: Bay; onSaved: () => void }) {
  const [name, setName] = useState(b.name);
  return (
    <div className="bay-edit">
      <TextInput label="Название бокса" value={name} onChange={setName} />
      <Switch label="Работает" size="sm" value={b.active} onChange={async (x) => { await supabase.from('bays').update({ active: x }).eq('id', b.id); onSaved(); }} />
      <Button variant="secondary" label="Сохранить" isDisabled={name === b.name || name.trim().length < 1} clickAction={async () => { await supabase.from('bays').update({ name: name.trim() }).eq('id', b.id); onSaved(); }} />
    </div>
  );
}

export function PhotosTab() {
  const { studio } = useOutletContext<StudioCtx>();
  const refresh = useRefresh();
  const [caption, setCaption] = useState('');
  const t = studio.tenant;
  return (
    <div className="settings">
      <section className="settings__block">
        <h2 className="settings__title">Добавить новую работу</h2>
        <TextInput label="Подпись к фото" value={caption} onChange={setCaption} placeholder="BMW X5 — керамика" />
        <FilePick variant="primary" label="Выбрать фото и добавить карточку" onFile={async (file) => {
          const url = await uploadImage(t.id, 'gallery', file);
          const maxSort = Math.max(-1, ...studio.gallery.map((g) => g.sort));
          await supabase.from('gallery').insert({ tenant_id: t.id, image_url: url, caption: caption.trim(), sort: maxSort + 1 });
          setCaption('');
          refresh();
        }} />
      </section>
      <section className="settings__block">
        <h2 className="settings__title">Работы на сайте ({studio.gallery.length})</h2>
        <ul className="photo-admin">
          {studio.gallery.map((g) => <PhotoCard key={g.id} g={g} onChanged={refresh} />)}
        </ul>
      </section>
    </div>
  );
}

function PhotoCard({ g, onChanged }: { g: GalleryItem; onChanged: () => void }) {
  const [caption, setCaption] = useState(g.caption);
  return (
    <li className="photo-admin__item" data-testid="photo-card">
      <img src={g.image_url} alt={g.caption || 'Фото работы'} loading="lazy" />
      <TextInput label="Подпись" value={caption} onChange={setCaption} />
      <div className="photo-admin__actions">
        <Button variant="secondary" size="sm" label="Сохранить подпись" isDisabled={caption === g.caption} clickAction={async () => {
          await supabase.from('gallery').update({ caption: caption.trim() }).eq('id', g.id);
          onChanged();
        }} />
        <FilePick variant="ghost" label="Заменить фото" onFile={async (file) => {
          const url = await uploadImage(g.tenant_id, 'gallery', file);
          await supabase.from('gallery').update({ image_url: url }).eq('id', g.id); // only this card changes
          onChanged();
        }} />
        <Button variant="ghost" size="sm" label="Удалить" icon={<Trash size={16} />} clickAction={async () => {
          if (!confirm('Удалить эту работу с сайта?')) return;
          await supabase.from('gallery').delete().eq('id', g.id);
          onChanged();
        }} />
      </div>
    </li>
  );
}

