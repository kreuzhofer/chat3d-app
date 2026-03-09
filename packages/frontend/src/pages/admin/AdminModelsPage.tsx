import { useAdmin } from "../../contexts/AdminContext";
import { ModelsTab } from "../../components/admin/ModelsTab";

export function AdminModelsPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <ModelsTab token={token} />;
}
