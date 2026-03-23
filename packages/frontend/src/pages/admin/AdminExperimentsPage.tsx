import { useAdmin } from "../../contexts/AdminContext";
import { ExperimentsTab } from "../../components/admin/ExperimentsTab";

export function AdminExperimentsPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <ExperimentsTab token={token} />;
}
