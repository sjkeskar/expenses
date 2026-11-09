import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Result } from "antd";
import { ApiError } from "../api";

// Where a screen's failure is shown (BUG-021): a load that useApi couldn't
// complete (lib/hooks.ts), or a bug that crashed the screen while drawing.
// App.tsx puts one on every route, so no screen handles this itself and
// none can end up blank. The menu and header stay usable around it.
//
// `resetKey` (the URL) clears a shown error when the user goes elsewhere;
// Retry draws the screen afresh, which loads its data again.
interface Props {
  resetKey: string;
  back?: { path: string; label: string }; // e.g. a detail screen's list
  children: ReactNode;
}

interface State {
  error?: Error;
  attempt: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A failed load is expected and already explained; a crash is a bug.
    if (!(error instanceof ApiError)) console.error("A screen crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  retry = () => this.setState((s) => ({ error: undefined, attempt: s.attempt + 1 }));

  render() {
    const { error, attempt } = this.state;
    if (error) return <Failure error={error} back={this.props.back} retry={this.retry} />;
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}

function Failure({ error, back, retry }: { error: Error; back?: Props["back"]; retry(): void }) {
  const navigate = useNavigate();
  const home = (
    <Button key="home" onClick={() => navigate("/")}>
      Go to Home
    </Button>
  );
  const backButton = back && (
    <Button key="back" type="primary" onClick={() => navigate(back.path)}>
      Back to {back.label}
    </Button>
  );

  if (!(error instanceof ApiError) && !(error instanceof TypeError && /fetch/i.test(error.message))) {
    return (
      <Result
        status="error"
        title="Something went wrong on this screen"
        subTitle="Reloading the page usually fixes it. If it keeps happening, please report it, with what you were doing."
        extra={[
          <Button key="reload" type="primary" onClick={() => window.location.reload()}>
            Reload the page
          </Button>,
          home,
        ]}
      />
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return <Result status="404" title={error.message} subTitle="The link may be mistyped or out of date." extra={[backButton, home].filter(Boolean)} />;
  }
  if (error instanceof ApiError && error.status === 403) {
    return <Result status="403" title="You can't open this" subTitle={error.message} extra={[backButton, home].filter(Boolean)} />;
  }
  // The server failed, or couldn't be reached (a network problem).
  const reason = error instanceof ApiError ? error.message : "The server couldn't be reached. Check the network connection.";
  return (
    <Result
      status="warning"
      title="This page couldn't be loaded"
      subTitle={reason}
      extra={[
        <Button key="retry" type="primary" onClick={retry}>
          Try again
        </Button>,
        backButton,
        home,
      ].filter(Boolean)}
    />
  );
}
