import { useAdmin } from "../../contexts/AdminContext";
import { GenerationTab } from "../../components/admin/GenerationTab";

export function AdminGenerationPage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <GenerationTab token={token} />;
}
