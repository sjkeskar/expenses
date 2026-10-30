import { Col, Form, Input, Row } from "antd";
import { COL } from "../../components/Page";

// The lab's name and contact details: they head every printed document.
export default function LabSettingsFields() {
  return (
    <Row gutter={16}>
      <Col {...COL.wide}>
        <Form.Item label="Lab name" name="labName" rules={[{ required: true, whitespace: true, message: "Enter the lab's name" }]}>
          <Input />
        </Form.Item>
      </Col>
      <Col {...COL.narrow}>
        <Form.Item label="Phone" name="phone" rules={[{ required: true, whitespace: true, message: "Enter a contact phone" }]}>
          <Input inputMode="tel" />
        </Form.Item>
      </Col>
      <Col {...COL.narrow}>
        <Form.Item label="Email" name="email" rules={[{ type: "email", message: "Enter a valid email" }]}>
          <Input inputMode="email" />
        </Form.Item>
      </Col>
      <Col {...COL.full}>
        <Form.Item label="Address" name="address" rules={[{ required: true, whitespace: true, message: "Enter the address" }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
      </Col>
    </Row>
  );
}
