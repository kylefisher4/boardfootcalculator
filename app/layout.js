export const metadata = {
  title: 'Board Footage Calculator',
  description: 'Material takeoff board footage calculator',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
