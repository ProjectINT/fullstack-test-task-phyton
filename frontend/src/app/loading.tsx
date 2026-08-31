/** Показывается, пока серверный page.tsx грузит начальные данные. */
export default function Loading() {
  return (
    <div className="d-flex justify-content-center align-items-center min-vh-100 bg-light">
      <div className="spinner-border text-secondary" role="status" />
    </div>
  );
}
