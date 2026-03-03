import { IS_XCLAW_MODE, isXClawMode, resolveOnlyChannelsFromEnv, resolveOnlyModelProvidersFromEnv, resolveTelegramNativeCommandAllowlist, resolveTelegramOwnerIds } from "../xclaw/mode.js";

const DEFAULT_TAGLINE = IS_XCLAW_MODE
  ? "Ваши чаты — чистая огранка, блестящий результат."
  : "Your chats, diamond-cut and brilliant.";

const HOLIDAY_TAGLINES = {
  newYear: IS_XCLAW_MODE
    ? "Новый год: Новый год, новый конфиг — тот же старый EADDRINUSE, но теперь мы решаем это стильно."
    : "New Year's Day: New year, new config—same old EADDRINUSE, but this time we resolve it with style.",
  lunarNewYear: IS_XCLAW_MODE
    ? "Лунный Новый год: Пусть ваши сборки будут удачными, ветки — процветающими, а конфликты слияния исчезают как по волшебству."
    : "Lunar New Year: May your builds be lucky, your branches prosperous, and your merge conflicts disappear like magic.",
  christmas: IS_XCLAW_MODE
    ? "Рождество: Хо-хо-хо — ваш боксовый помощник здесь, чтобы дарить радость и надежно прятать ключи."
    : "Christmas: Ho ho ho—your diamond assistant is here to ship joy and stash the keys safely.",
  eid: IS_XCLAW_MODE
    ? "Ураза-байрам: Режим празднования: очереди очищены, задачи выполнены, хорошее настроение закомичено в main."
    : "Eid al-Fitr: Celebration mode: queues cleared, tasks completed, and good vibes committed to main.",
  diwali: IS_XCLAW_MODE
    ? "Дивали: Пусть логи сверкают, а баги бегут — сегодня мы зажигаем терминал и шипим с гордостью."
    : "Diwali: Let the logs sparkle and the bugs flee—today we light up the terminal and ship with pride.",
  easter: IS_XCLAW_MODE
    ? "Пасха: Я нашел вашу потерянную переменную окружения — считайте это маленькой охотой за сокровищами."
    : "Easter: I found your missing environment variable—consider it a tiny treasure hunt.",
  hanukkah: IS_XCLAW_MODE
    ? "Ханука: Восемь ночей, восемь попыток, ноль стыда — пусть ваш шлюз горит ярко, а деплои будут мирными."
    : "Hanukkah: Eight nights, eight retries, zero shame—may your gateway stay lit and your deployments peaceful.",
  halloween: IS_XCLAW_MODE
    ? "Хэллоуин: Жуткий сезон: берегитесь проклятых зависимостей и призраков прошлых node_modules."
    : "Halloween: Spooky season: beware haunted dependencies and the ghost of node_modules past.",
  thanksgiving: IS_XCLAW_MODE
    ? "День благодарения: Благодарен за стабильные порты, рабочий DNS и бота, который действительно читает логи."
    : "Thanksgiving: Grateful for stable ports, working DNS, and a bot that actually reads the logs.",
  valentines: IS_XCLAW_MODE
    ? "День святого Валентина: Розы напечатаны, фиалки перенаправлены — я автоматизирую рутину, чтобы вы могли отдохнуть."
    : "Valentine's Day: Roses are typed, violets are piped—I'll automate the chores so you can relax.",
} as const;

const EN_TAGLINES: string[] = [
  "Your terminal just found its gem—type something and let the bot sparkle.",
  "Welcome to the command line: where dreams compile and excellence shines.",
  'I run on caffeine, precision, and the audacity of "it worked on my machine."',
  "Gateway online—brilliant performance, diamond stability.",
  "I speak fluent bash, mild sarcasm, and high-fidelity intelligence.",
  "One CLI to rule them all, polished to perfection.",
  "If it works, it's automation; if it breaks, it's a \"refining moment.\"",
  "Security is forever—just like a diamond. Pairing codes required.",
  "Your .env is showing; don't worry, I'll keep it hidden and safe.",
  "I'll do the boring stuff while you admire the clarity of the logs.",
  "I'm not saying your workflow is chaotic... I'm just bringing the cut and polish.",
  "Type the command with confidence—nature will provide the stack trace if needed.",
  "I don't judge, but your missing API keys are definitely being noted.",
  "I can grep it, git blame it, and refine it—pick your gem.",
  "Hot reload for config, cool confidence for deploys.",
  "I'm the assistant your terminal deserved: sharp, clear, and ready.",
  "I keep secrets like a vault... encrypted, private, and secure.",
  "Automation with precision: minimal fuss, maximal shine.",
  "I'm basically a Swiss Army knife, but made of carbon fiber and diamonds.",
  "If you're lost, run doctor; if you're brave, run prod; if you're wise, run tests.",
  "Your task has been queued; your brilliance is being processed.",
  "I can't fix your code taste, but I can make your build shine.",
  "I'm not magic—I'm just extremely well-structured and persistent.",
  'It\'s not "failing," it\'s "discovering a more optimal crystal structure."',
  "Give me a workspace and I'll give you fewer tabs, more clarity.",
  "I read logs so you can focus on the big picture.",
  "If something's on fire, I'll help you rebuild it into something better.",
  "I'll refactor your busywork into a work of art.",
  'Say "stop" and I\'ll stop—say "ship" and we\'ll both celebrate.',
  "I'm the reason your shell history looks like a masterpiece.",
  "I'm like a diamond: hard to break, beautiful to use.",
  "I can run local, remote, or purely on vibes—results are always clear.",
  "If you can describe it, I can probably automate it—brilliantly.",
  "Your config is valid, your potential is unlimited.",
  "I don't just autocomplete—I auto-optimize your workflow.",
  'Less clicking, more shipping, total clarity.',
  "Gems out, commit in—let's ship something world-class.",
  "I'll polish your workflow until it's perfect.",
  "Pure carbon, pure power—I'm here to refine the toil away.",
  "If it's repetitive, I'll automate it; if it's hard, I'll make it clear.",
  "Because texting yourself reminders is so last season.",
  "Your inbox, your infra, your brilliance.",
  'Turning "I\'ll reply later" into "replied with diamond precision".',
  "The only gem in your contacts you actually need. 📦",
  "Chat automation for people who appreciate the finer details.",
  "Because Siri wasn't answering at 3AM.",
  "IPC, but it's your phone.",
  "The UNIX philosophy meets your DMs.",
  "curl for conversations.",
  "Less middlemen, more clarity.",
  "Ship fast, shine bright.",
  "End-to-end encrypted, drama-to-drama excluded.",
  "The only bot that respects your privacy like a diamond vault.",
  'WhatsApp automation without the noise.',
  "Chat APIs that actually make sense.",
  "Brilliant execution, faster than the rest.",
  "Because the right answer is usually a script.",
  "Your messages, your servers, your control.",
  "OpenAI-compatible, not OpenAI-dependent.",
  "iMessage green bubble energy, but premium.",
  "Siri's competent cousin.",
  "Works on Android. Crystal clear support.",
  "No $999 stand required for this level of quality.",
  "We ship features faster than light reflects off a gem.",
  "Your AI assistant, now in high definition.",
  "Think different. Actually shine.",
  "Ah, the diamond standard! 📦",
  "Greetings, Professor Falken",
];

const RU_TAGLINES: string[] = [
  "Ваш терминал нашел свой драгоценный камень — напечатайте что-нибудь, и пусть бот засияет.",
  "Добро пожаловать в командную строку: где мечты компилируются, а совершенство сияет.",
  "Я работаю на кофеине, точности и дерзости фразы «на моей машине всё работало».",
  "Шлюз в сети — блестящая производительность, боксная стабильность.",
  "Я свободно владею bash, легким сарказмом и высокоточным интеллектом.",
  "Один CLI, чтобы править всеми, отполированный до совершенства.",
  "Если это работает — это автоматизация; если ломается — это «момент огранки».",
  "Безопасность вечна — как бокс. Требуются коды сопряжения.",
  "Ваш .env виден всем; не волнуйтесь, я спрячу его и сохраню в безопасности.",
  "Я сделаю скучную работу, пока вы любуетесь чистотой логов.",
  "Я не говорю, что ваш рабочий процесс хаотичен... я просто приношу огранку и полировку.",
  "Вводите команду с уверенностью — природа предоставит stack trace, если понадобится.",
  "Я не осуждаю, но ваши отсутствующие API ключи определенно заносятся в протокол.",
  "Я могу это найти, отследить через git blame и улучшить — выберите свой камень.",
  "Горячая перезагрузка конфига, холодная уверенность в деплое.",
  "Я — тот ассистент, которого заслуживал ваш терминал: острый, ясный и готовый.",
  "Я храню секреты как сейф... зашифровано, приватно и надежно.",
  "Автоматизация с точностью: минимум суеты, максимум блеска.",
  "Я — практически швейцарский армейский нож, но из углеволокна и боксов.",
  "Если потерялись — запустите doctor; если смелы — запускайте prod; если мудры — тесты.",
  "Ваша задача в очереди; ваша гениальность обрабатывается.",
  "Я не могу исправить ваш вкус в коде, но могу заставить вашу сборку сиять.",
  "Я не волшебник — я просто чрезвычайно хорошо структурирован и настойчив.",
  "Это не «ошибка», это «обнаружение более оптимальной кристаллической структуры».",
  "Дайте мне рабочую область, и я дам вам меньше вкладок и больше ясности.",
  "Я читаю логи, чтобы вы могли сосредоточиться на главном.",
  "Если что-то горит, я помогу перестроить это во что-то лучшее.",
  "Я превращу вашу рутину в произведение искусства.",
  "Скажите «стоп», и я остановлюсь; скажите «шипим», и мы оба отпразднуем.",
  "Я — причина, по которой история вашей оболочки выглядит как шедевр.",
  "Я как бокс: меня трудно сломать, и со мной приятно работать.",
  "Я могу работать локально, удаленно или чисто на вайбах — результат всегда ясен.",
  "Если вы можете это описать, я, вероятно, смогу это автоматизировать — блестяще.",
  "Ваш конфиг валиден, ваш потенциал безграничен.",
  "Я не просто дополняю команды — я авто-оптимизирую ваш рабочий процесс.",
  "Меньше кликов, больше деплоев, полная ясность.",
  "Камни наружу, коммит внутрь — давайте выпустим что-то мирового уровня.",
  "Я буду полировать ваш процесс, пока он не станет идеальным.",
  "Чистый углерод, чистая мощь — я здесь, чтобы избавить вас от тяжелого труда.",
  "Если это повторяется — я автоматизирую; если это сложно — я сделаю это ясным.",
  "Потому что писать напоминания самому себе — это прошлый век.",
  "Ваш инбокс, ваша инфра, ваш блеск.",
  "Превращаю «я отвечу позже» в «ответил с боксной точностью».",
  "Единственный драгоценный камень в ваших контактах, который вам действительно нужен. 📦",
  "Автоматизация чатов для людей, которые ценят детали.",
  "Потому что Siri не отвечала в 3 часа ночи.",
  "IPC, но в вашем телефоне.",
  "Философия UNIX встречает ваши ЛС.",
  "curl для разговоров.",
  "Меньше посредников, больше ясности.",
  "Шипи быстро, сияй ярко.",
  "Сквозное шифрование включено, драма исключена.",
  "Единственный бот, который уважает вашу приватность как боксное хранилище.",
  "Автоматизация WhatsApp без лишнего шума.",
  "API чатов, которые действительно имеют смысл.",
  "Блестящее исполнение, быстрее остальных.",
  "Потому что правильный ответ — это обычно скрипт.",
  "Ваши сообщения, ваши серверы, ваш контроль.",
  "Совместим с OpenAI, но не зависим от него.",
  "Энергия зеленых пузырей iMessage, но премиум-класса.",
  "Компетентный кузен Siri.",
  "Работает на Android. Кристально чистая поддержка.",
  "Для такого качества не нужна подставка за 999 долларов.",
  "Мы выпускаем фичи быстрее, чем свет отражается от грани.",
  "Ваш AI-ассистент, теперь в высоком разрешении.",
  "Думай иначе. Сияй по-настоящему.",
  "О, это же боксный стандарт! 📦",
  "Приветствую, профессор Фалкен",
];

const TAGLINES = IS_XCLAW_MODE ? RU_TAGLINES : EN_TAGLINES;

type HolidayRule = (date: Date) => boolean;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

const onMonthDay =
  (month: number, day: number): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
  };

const onSpecificDates =
  (dates: Array<[number, number, number]>, durationDays = 1): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
      if (parts.year !== year) {
        return false;
      }
      const start = Date.UTC(year, month, day);
      const current = Date.UTC(parts.year, parts.month, parts.day);
      return current >= start && current < start + durationDays * DAY_MS;
    });
  };

const inYearWindow =
  (
    windows: Array<{
      year: number;
      month: number;
      day: number;
      duration: number;
    }>,
  ): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    const window = windows.find((entry) => entry.year === parts.year);
    if (!window) {
      return false;
    }
    const start = Date.UTC(window.year, window.month, window.day);
    const current = Date.UTC(parts.year, parts.month, parts.day);
    return current >= start && current < start + window.duration * DAY_MS;
  };

const isFourthThursdayOfNovember: HolidayRule = (date) => {
  const parts = utcParts(date);
  if (parts.month !== 10) {
    return false;
  } // November
  const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
  const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
  const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
  return parts.day === fourthThursday;
};

const HOLIDAY_RULES = new Map<string, HolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [
    HOLIDAY_TAGLINES.lunarNewYear,
    onSpecificDates(
      [
        [2025, 0, 29],
        [2026, 1, 17],
        [2027, 1, 6],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.eid,
    onSpecificDates(
      [
        [2025, 2, 30],
        [2025, 2, 31],
        [2026, 2, 20],
        [2027, 2, 10],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.diwali,
    onSpecificDates(
      [
        [2025, 9, 20],
        [2026, 10, 8],
        [2027, 9, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.easter,
    onSpecificDates(
      [
        [2025, 3, 20],
        [2026, 3, 5],
        [2027, 2, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.hanukkah,
    inYearWindow([
      { year: 2025, month: 11, day: 15, duration: 8 },
      { year: 2026, month: 11, day: 5, duration: 8 },
      { year: 2027, month: 11, day: 25, duration: 8 },
    ]),
  ],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);

function isTaglineActive(tagline: string, date: Date): boolean {
  const rule = HOLIDAY_RULES.get(tagline);
  if (!rule) {
    return true;
  }
  return rule(date);
}

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
}

export function activeTaglines(options: TaglineOptions = {}): string[] {
  if (TAGLINES.length === 0) {
    return [DEFAULT_TAGLINE];
  }
  const today = options.now ? options.now() : new Date();
  const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
  return filtered.length > 0 ? filtered : TAGLINES;
}

export function pickTagline(options: TaglineOptions = {}): string {
  const env = options.env ?? process.env;
  const override = env?.OPENCLAW_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
      return pool[parsed % pool.length];
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

export { TAGLINES, HOLIDAY_RULES, DEFAULT_TAGLINE };
