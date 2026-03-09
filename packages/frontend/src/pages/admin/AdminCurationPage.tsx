import { useAdmin } from "../../contexts/AdminContext";
import { CurationTab } from "../../components/admin/CurationTab";

export function AdminCurationPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <CurationTab token={token} />;
}
