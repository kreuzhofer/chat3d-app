import { useAdmin } from "../../contexts/AdminContext";
import { CostAnalysisTab } from "../../components/admin/CostAnalysisTab";

export function AdminCostsPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <CostAnalysisTab token={token} />;
}
