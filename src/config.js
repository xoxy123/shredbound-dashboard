// Same-origin API when served by the Worker. GitHub Pages overrides this at build time.
export const apiBase = '';
// Shredbound's Supabase project. The anon key is public by design (role "anon");
// edge functions use it only to pass the gateway. Never put a service-role key here.
export const supabaseUrl = 'https://yptfcpxaihfboteltuhq.supabase.co';
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGZjcHhhaWhmYm90ZWx0dWhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjE4MDUsImV4cCI6MjEwNjg5NzgwNX0.5hoodydTZJexjWtI81ou8mfxfFPb84f2xVxYRCaAHtM';
