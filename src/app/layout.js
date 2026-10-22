import './globals.css';

export const metadata = {
  title: 'Restaurante Dona Augusta — Faça seu pedido',
  description: 'Monte sua marmita e envie o pedido pelo WhatsApp.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
