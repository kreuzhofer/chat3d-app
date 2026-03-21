import { useAdmin } from "../../contexts/AdminContext";
import { PipelinePerformanceTab } from "../../components/admin/PipelinePerformanceTab";

export function AdminPipelinePage() {
  const { token } = useAdmin();
  if (!token) return null;
  return <PipelinePerformanceTab token={token} />;
}
