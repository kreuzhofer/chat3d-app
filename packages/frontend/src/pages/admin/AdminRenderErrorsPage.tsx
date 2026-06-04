import { useAdmin } from "../../contexts/AdminContext";
import { RenderErrorsTab } from "../../components/admin/RenderErrorsTab";

export function AdminRenderErrorsPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <RenderErrorsTab token={token} />;
}
