// Non-destructive checks used by `pnpm tenant:check`: safe to run against any live studio.
import { expect, test } from '@playwright/test';

test('главная: название, кнопка записи, услуги, контакты', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.hero__title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записаться' }).first()).toBeVisible();
  await expect(page.locator('.dash__card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Запись в студию' })).toBeVisible();
  await expect(page.locator('.svc-card').first()).toBeVisible();
  await expect(page.getByText('График работы')).toBeVisible();
  // the floating nav must not cover the end of the page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footer = await page.locator('.footer').boundingBox();
  const dock = await page.locator('.dock__bar').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(dock!.y + 1);
});

test('кнопка «Записаться» ведёт к записи, видно свободное время', async ({ page }) => {
  await page.goto('./');
  await page.locator('.hero__cta-btn').click();
  await page.locator('.svc-option').first().click();
  await expect(page.locator('[data-testid="slot-free"]').first()).toBeVisible();
});

test('помощник отвечает на кнопку-пример по данным студии', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('listitem').filter({ hasText: 'Сколько стоит полировка?' }).first().click();
  const answer = page.locator('.bubble--assistant').last();
  await expect(answer).toContainText(/₽/, { timeout: 40_000 });
});

test('страница «Услуги» и «Моя запись» открываются из нижнего меню', async ({ page }) => {
  await page.goto('./');
  await page.locator('.dock__item', { hasText: 'Услуги' }).click();
  await expect(page.getByRole('heading', { name: 'Услуги', level: 1 })).toBeVisible();
  await page.locator('.dock__item', { hasText: 'Моя запись' }).click();
  await expect(page.getByRole('heading', { name: 'Моя запись' })).toBeVisible();
});
