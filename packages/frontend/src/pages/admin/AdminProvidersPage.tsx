import { useAdmin } from "../../contexts/AdminContext";
import { ProvidersTab } from "../../components/admin/ProvidersTab";

export function AdminProvidersPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <ProvidersTab token={token} />;
}
