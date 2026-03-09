import { useAdmin } from "../../contexts/AdminContext";
import { KnowledgeTab } from "../../components/admin/KnowledgeTab";

export function AdminKnowledgePage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <KnowledgeTab token={token} />;
}
