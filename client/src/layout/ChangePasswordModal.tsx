import { Form, Input } from "antd";
import { api } from "../api";
import { useSession } from "../auth/session";
import FormModal from "../components/FormModal";
import PasswordFields from "../components/PasswordFields";

// Changing your own password ends the session (the server destroys it), so
// on success the user signs in again with the new one.
export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const { signOut } = useSession();

  const change = async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    await api("/auth/password", { method: "PATCH", body: { currentPassword, newPassword } });
    await signOut("Password changed. Please sign in with your new password.");
  };

  return (
    <FormModal title="Change password" okText="Change password" open={open} onSubmit={change} onClose={onClose}>
      <Form.Item label="Current password" name="currentPassword" rules={[{ required: true, message: "Enter your current password" }]}>
        <Input.Password autoComplete="current-password" />
      </Form.Item>
      <PasswordFields name="newPassword" label="New password" />
    </FormModal>
  );
}
