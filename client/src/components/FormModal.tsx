import { useId, useState, type ReactNode } from "react";
import { Alert, Form, Modal } from "antd";
import { useAction } from "../lib/hooks";

// A dialog wrapping one form: the OK button submits, stays busy while the
// request runs (no double submit), and the server's error is shown inside
// the dialog rather than closing it.
//
// The form mounts afresh each time the dialog opens (destroyOnHidden, no
// shared form instance — a re-mounted antd form would otherwise keep the
// last dialog's values), and its unique name prefixes its field ids, so two
// dialogs never share an id. The OK button sits outside the <form>, so it
// submits it through the HTML `form` attribute.
export default function FormModal<T extends object>({
  title,
  open,
  okText = "Save",
  initialValues,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  okText?: string;
  initialValues?: Partial<T>;
  onSubmit(values: T): Promise<unknown>;
  onClose(): void;
  children: ReactNode;
}) {
  const formName = `form${useId().replace(/\W/g, "")}`;
  const [error, setError] = useState<string>();
  const close = () => {
    setError(undefined);
    onClose();
  };
  const [submit, busy] = useAction(async (values: T) => {
    setError(undefined);
    try {
      await onSubmit(values);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <Modal
      title={title}
      open={open}
      okText={okText}
      okButtonProps={{ htmlType: "submit", form: formName, loading: busy }}
      onCancel={close}
      destroyOnHidden
      styles={{ body: { paddingTop: 12 } }}
    >
      {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
      <Form name={formName} layout="vertical" initialValues={initialValues} onFinish={submit} requiredMark="optional">
        {children}
      </Form>
    </Modal>
  );
}
