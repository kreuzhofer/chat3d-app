import { useAdmin } from "../../contexts/AdminContext";
import { DataQualityTab } from "../../components/admin/DataQualityTab";

export function AdminDataQualityPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <DataQualityTab token={token} />;
}
