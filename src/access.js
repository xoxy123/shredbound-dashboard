// Only the requested GitHub Pages origin may make browser requests across origins.
export const dashboardOrigin = 'https://xoxy123.github.io';
export const allowedOrigin = origin => origin === dashboardOrigin;
