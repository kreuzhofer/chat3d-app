import { useParams } from "react-router-dom";
import { useAdmin } from "../../contexts/AdminContext";
import { ExperimentsTab } from "../../components/admin/ExperimentsTab";

export function AdminExperimentsPage() {
  const { token } = useAdmin();
  const { experimentId } = useParams<{ experimentId?: string }>();
  if (!token) return null;
  return <ExperimentsTab token={token} selectedExperimentId={experimentId} />;
}
