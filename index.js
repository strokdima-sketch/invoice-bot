require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const PDFDocument = require("pdfkit");

const bot = new Telegraf(process.env.BOT_TOKEN);

// состояния пользователей в памяти (пока без базы)
const state = new Map(); // userId -> { step, draft }

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
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountNumber);
}

bot.start((ctx) => {
  ctx.reply(
    "Привет! Я бот для счётов 🧾\n\nКоманды:\n/new — новый счёт\n/cancel — отмена"
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

  if (!u.step) return; // если не в процессе /new — игнорим

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
      return ctx.reply("Не похоже на число 😅 Пример: 1200 или 1200.50");
    }

    u.draft.amount = num; // хранить числом
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

    // убираем клавиатуру, чтобы не залипала
    await ctx.reply("Принято, делаю PDF…", Markup.removeKeyboard());

    // --- PDF в память (без файлов на диске) ---
    const fileName = `invoice_${Date.now()}.pdf`;

    const doc = new PDFDocument({ margin: 50 });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));

    doc.on("error", async (err) => {
      console.error("PDF error:", err);
      try {
        await ctx.reply("Не смог создать PDF 😕 Попробуй ещё раз.");
      } catch (_) {}
    });

    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);

        const amountStr = formatMoney(d.amount);
        const dateStr = formatDateEuropeWarsaw(new Date());

        // отправляем PDF
        await ctx.replyWithDocument({ source: pdfBuffer, filename: fileName });

        // подтверждение
        await ctx.reply(
          `Готово ✅\n\nКлиент: ${d.client}\nУслуга: ${d.service}\nСумма: ${amountStr} ${d.currency}\nДата: ${dateStr}`
        );
      } catch (err) {
        console.error("Send error:", err);
        await ctx.reply("Не смог отправить PDF 😕 Попробуй ещё раз.");
      }
    });

    // наполнение PDF
    const amountStr = formatMoney(d.amount);
    const dateStr = formatDateEuropeWarsaw(new Date());

    doc.fontSize(20).text("INVOICE", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`Клиент: ${d.client}`);
    doc.text(`Услуга: ${d.service}`);
    doc.text(`Сумма: ${amountStr} ${d.currency}`);
    doc.text(`Дата: ${dateStr}`);

    doc.end();
    return;
  }
});

bot.launch();
console.log("Bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
