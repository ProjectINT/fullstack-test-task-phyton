/** Показывается, пока серверный page.tsx грузит начальные данные. */
const Loading = () => (
  <div className="d-flex justify-content-center align-items-center min-vh-100 bg-light">
    <div className="spinner-border text-secondary" role="status" />
  </div>
);

export default Loading;
