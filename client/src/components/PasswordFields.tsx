import { Col, Form, Input, type ColProps } from "antd";

// The password policy (src/utils/passwordPolicy.js), checked as you type;
// the server checks it again.
const POLICY = [
  { min: 6, message: "At least 6 characters" },
  { pattern: /[0-9]/, message: "At least one number" },
  { pattern: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/, message: "At least one special character" },
];

// A new password and its confirmation, as form fields `name` and `${name}Confirm`.
// Given `col`, each sits in its own grid column (inside a page's <Row>);
// without it they stack, as in a dialog.
export default function PasswordFields({ name = "password", label = "Password", col }: { name?: string; label?: string; col?: ColProps }) {
  const fields = [
    <Form.Item key="password" label={label} name={name} rules={[{ required: true, message: "Enter a password" }, ...POLICY]} hasFeedback>
      <Input.Password autoComplete="new-password" />
    </Form.Item>,
    <Form.Item
      key="confirm"
      label={`Confirm ${label.toLowerCase()}`}
      name={`${name}Confirm`}
      dependencies={[name]}
      hasFeedback
      rules={[
        { required: true, message: "Confirm the password" },
        ({ getFieldValue }) => ({
          validator: (_, value) => (value === getFieldValue(name) ? Promise.resolve() : Promise.reject(new Error("The passwords don't match"))),
        }),
      ]}
    >
      <Input.Password autoComplete="new-password" />
    </Form.Item>,
  ];
  return <>{col ? fields.map((field) => <Col key={field.key} {...col}>{field}</Col>) : fields}</>;
}
