// Full flow on the sample studio: creates (test) bookings, then cancels them.
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const slug = process.env.TENANT ?? 'graphite';
const owner = fs.existsSync(`tenants/${slug}/.owner`) ? fs.readFileSync(`tenants/${slug}/.owner`, 'utf8').split('\n') : null;
const run = `E2E-${Date.now().toString(36)}`;

async function pickWashAndDay(page: Page, dayIndex: number): Promise<number> {
  await page.goto('./');
  await page.locator('.svc-option', { hasText: 'Детейлинг-мойка' }).click();
  const days = page.locator('.day:not([disabled])');
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    await days.nth((dayIndex + i) % n).click();
    await expect(page.locator('.slot').first()).toBeVisible();
    if (await page.locator('[data-testid="slot-free"]').count()) return (dayIndex + i) % n;
  }
  throw new Error('no free slots in the booking horizon');
}

async function book(page: Page, time: string, name: string, double = false) {
  await page.locator('.slot', { hasText: time }).first().click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Телефон').fill('+7 900 123-45-67');
  await page.getByLabel('Автомобиль').fill('Test Car');
  const confirm = page.getByRole('button', { name: 'Подтвердить запись' });
  if (double) await confirm.dblclick();
  else await confirm.click();
}

test.describe.configure({ mode: 'serial' });

test('клиент записывается, видит запись; занятое время нельзя взять повторно; владелец видит запись', async ({ browser, page }) => {
  test.setTimeout(180_000);
  const dayIndex = await pickWashAndDay(page, 4 + Math.floor(Math.random() * 12));
  const time = (await page.locator('[data-testid="slot-free"] .slot__time').last().textContent())!.trim();

  // 1) first client — double click on confirm must create exactly one booking
  await book(page, time, `${run} Первый`, true);
  await expect(page.getByText('Вы записаны')).toBeVisible();
  await expect(page.locator('.ticket').first()).toContainText('Детейлинг-мойка');
  await expect(page.locator('.ticket').first()).toContainText('Test Car');
  await expect(page.getByText('Напомнить за сутки?')).toBeVisible();
  await expect(page.getByRole('button', { name: /В календарь/ })).toBeVisible();

  // 2) second client takes the second bay at the same time
  const p2 = await (await browser.newContext()).newPage();
  await pickWashAndDay(p2, dayIndex);
  await book(p2, time, `${run} Второй`);
  await expect(p2.getByText('Вы записаны')).toBeVisible();

  // 3) third client: both bays are busy -> slot is marked busy and disabled
  const p3 = await (await browser.newContext()).newPage();
  await pickWashAndDay(p3, dayIndex);
  const busySlot = p3.locator('.slot', { hasText: time }).first();
  await expect(busySlot).toBeDisabled();
  await expect(busySlot).toContainText('занято');

  // 4) owner sees the bookings in the cabinet
  test.skip(!owner, 'no owner credentials file');
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('admin');
  await admin.getByLabel('Почта').fill(owner![0]);
  await admin.getByLabel('Пароль').fill(owner![1]);
  await admin.getByRole('button', { name: 'Войти' }).click();
  await expect(admin.getByRole('heading', { name: /Graphite|.+/ , level: 1 })).toBeVisible();
  await admin.getByRole('radio', { name: 'Неделя' }).click().catch(() => admin.getByText('Неделя').click());
  for (let i = 0; i < 5; i++) {
    await expect(admin.locator('.slots-loading')).toHaveCount(0);
    await admin.waitForLoadState('networkidle');
    if (await admin.getByText(`${run} Первый`).count()) break;
    await admin.getByRole('button', { name: 'Вперёд' }).click();
  }
  const card = admin.locator('.owner-card', { hasText: `${run} Первый` });
  await expect(card).toHaveCount(1); // double click did not create a duplicate
  await expect(admin.locator('.owner-card', { hasText: `${run} Второй` })).toHaveCount(1);

  // owner marks car as accepted and records a payment
  await card.getByRole('button', { name: 'Машина принята' }).click();
  await expect(card).toContainText('Машина принята');
  await card.getByRole('button', { name: 'Оплата' }).click();
  await admin.getByRole('button', { name: 'Сохранить оплату' }).click();
  await expect(card).toContainText(/оплачено 3\s?500/);

  // the second client cancels online (the first car is already accepted by the owner)
  await p2.getByRole('button', { name: 'Отменить запись' }).first().click();
  await p2.getByRole('dialog').getByRole('button', { name: 'Отменить запись' }).click();
  await expect(p2.locator('.ticket').first()).toContainText('Отменена', { timeout: 15_000 });
});

test('владелец: помощник отвечает по базе', async ({ page }) => {
  test.skip(!owner, 'no owner credentials file');
  await page.goto('admin');
  await page.getByLabel('Почта').fill(owner![0]);
  await page.getByLabel('Пароль').fill(owner![1]);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('tab', { name: 'Помощник' }).click();
  await page.locator('.chip', { hasText: 'Сколько денег получено?' }).click();
  await expect(page.locator('.bubble--assistant').last()).toContainText(/₽/, { timeout: 40_000 });
});
