require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const PDFDocument = require("pdfkit");
const { createCheckoutSession } = require("./stripe");

if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN is not set");

const bot = new Telegraf(process.env.BOT_TOKEN);

// state in memory: userId -> { step, draft }
const state = new Map();

function getUser(userId) {
  if (!state.has(userId)) state.set(userId, { step: null, draft: {} });
  return state.get(userId);
}

function formatDateEuropeWarsaw(date = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMoney(amountNumber) {
  const n = Number(amountNumber);
  if (!Number.isFinite(n)) return String(amountNumber);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function buildPdfBuffer({ client, service, amount, currency, dateStr }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("INVOICE", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Клиент: ${client}`);
    doc.text(`Услуга: ${service}`);
    doc.text(`Сумма: ${formatMoney(amount)} ${currency}`);
    doc.text(`Дата: ${dateStr}`);

    doc.end();
  });
}

bot.start((ctx) => {
  ctx.reply(
    "Привет! Я бот для счетов 🧾\n\nКоманды:\n/new — новый счёт\n/cancel — отмена"
  );
});

bot.command("cancel", async (ctx) => {
  const u = getUser(ctx.from.id);
  u.step = null;
  u.draft = {};
  await ctx.reply("Ок, отменил ✅", Markup.removeKeyboard());
});

bot.command("new", async (ctx) => {
  const u = getUser(ctx.from.id);
  u.step = "client";
  u.draft = {};
  await ctx.reply("Шаг 1/4: имя клиента?", Markup.removeKeyboard());
});

bot.on("text", async (ctx) => {
  const u = getUser(ctx.from.id);
  const text = (ctx.message.text || "").trim();
  if (!u.step) return;

  if (u.step === "client") {
    u.draft.client = text;
    u.step = "service";
    return ctx.reply("Шаг 2/4: что за услуга/работа?");
  }

  if (u.step === "service") {
    u.draft.service = text;
    u.step = "amount";
    return ctx.reply("Шаг 3/4: сумма (например 1200.50)?");
  }

  if (u.step === "amount") {
    const normalized = text.replace(",", ".");
    const num = Number(normalized);

    if (!Number.isFinite(num) || num <= 0) {
      return ctx.reply("Не похоже на число 😕 Пример: 1200 или 1200.50");
    }

    u.draft.amount = num;
    u.step = "currency";

    return ctx.reply(
      "Шаг 4/4: валюта?",
      Markup.keyboard([["PLN", "EUR", "USD"]]).oneTime().resize()
    );
  }

  if (u.step === "currency") {
    const cur = text.toUpperCase();
    if (!["PLN", "EUR", "USD"].includes(cur)) {
      return ctx.reply(
        "Выбери валюту кнопкой: PLN / EUR / USD",
        Markup.keyboard([["PLN", "EUR", "USD"]]).oneTime().resize()
      );
    }

    u.draft.currency = cur;

    // забираем данные и сбрасываем состояние
    const d = u.draft;
    u.step = null;
    u.draft = {};

    await ctx.reply("Принято, делаю PDF…", Markup.removeKeyboard());

    try {
      const dateStr = formatDateEuropeWarsaw(new Date());
      const amountStr = formatMoney(d.amount);

      // 1) PDF buffer
      const pdfBuffer = await buildPdfBuffer({
        client: d.client,
        service: d.service,
        amount: d.amount,
        currency: d.currency,
        dateStr,
      });

      // 2) Stripe Checkout URL
      const checkoutUrl = await createCheckoutSession({
        amount: d.amount,
        currency: d.currency,
        description: `Оплата: ${d.service}`,
        metadata: {
          client: d.client,
          service: d.service,
          currency: d.currency,
          amount: String(d.amount),
          date: dateStr,
          telegram_user_id: String(ctx.from.id),
        },
      });

      // 3) Send PDF
      const fileName = `invoice_${Date.now()}.pdf`;
      await ctx.replyWithDocument({ source: pdfBuffer, filename: fileName });

      // 4) Confirmation + Pay button
      await ctx.reply(
        `Готово ✅\n\nКлиент: ${d.client}\nУслуга: ${d.service}\nСумма: ${amountStr} ${d.currency}\nДата: ${dateStr}\n\nОплата:`,
        Markup.inlineKeyboard([Markup.button.url("💳 Оплатить", checkoutUrl)])
      );
    } catch (err) {
      console.error("Checkout/PDF error:", err);
      await ctx.reply(
        "Не смог сделать оплату/ PDF 😕\nПроверь STRIPE_* переменные и логи Railway."
      );
    }
  }
});

bot.launch();
console.log("Bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
