import { analyzeIngredients, APPROVAL_CONTINUATION_POLICY } from '@/lib/builder';

const sample = analyzeIngredients({
  repository: 'officialtreytrizzy-lab/Autonomous-Project-Builder',
  backend: 'supabase',
  deployment: 'vercel',
  workflow: 'windmill',
  needsAuthenticatedBrowser: true,
  needsWindowsHost: true,
});

const levelColor: Record<string, string> = {
  green: '#2dd4bf',
  yellow: '#facc15',
  red: '#fb7185',
};

export default function Home() {
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '48px 24px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: 42, marginBottom: 8 }}>Autonomous Project Builder</h1>
      <p style={{ opacity: 0.75, marginBottom: 32 }}>{APPROVAL_CONTINUATION_POLICY}</p>
      <section style={{ display: 'grid', gap: 14 }}>
        {sample.map((item) => (
          <article key={item.id} style={{ border: '1px solid #333', borderRadius: 18, padding: 18, display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 14, alignItems: 'center' }}>
            <span aria-label={item.level} style={{ width: 14, height: 14, borderRadius: 999, background: levelColor[item.level], boxShadow: `0 0 18px ${levelColor[item.level]}` }} />
            <div>
              <strong>{item.label}</strong>
              <div style={{ opacity: 0.72, marginTop: 5 }}>{item.detail}</div>
            </div>
            <code>{item.target}</code>
          </article>
        ))}
      </section>
    </main>
  );
}
