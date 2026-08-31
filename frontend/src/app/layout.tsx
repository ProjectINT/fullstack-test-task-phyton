import type { Metadata } from "next";
import 'bootstrap/dist/css/bootstrap.min.css';
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: t("metadata.title"),
  description: t("metadata.description"),
};

const RootLayout = ({
  children
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html lang='ru'>
    <body>{children}</body>
  </html>
);

export default RootLayout;
