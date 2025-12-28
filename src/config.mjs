import defaultImage from './assets/images/default.png';

const CONFIG = {
  name: 'Brook',

  origin: 'https://bybrooklyn.dev/',
  basePathname: '/',
  trailingSlash: false,

  title: 'Brook — Student, computer enthusiast, and server tinkerer',
  description: `I like computers. I build them, break them, and run servers on them. Hands-on student exploring Linux, hardware, and self-hosting.`,
  defaultImage: defaultImage,

  defaultTheme: 'dark', // Values: "system" | "light" | "dark" | "light:only" | "dark:only"
};

export const SITE = { ...CONFIG };
