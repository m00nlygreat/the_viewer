import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; fileName: string; sourceText: string }
interface State { failed: boolean }

export class FeatureLoadBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State { return { failed: true } }

  render() {
    if (this.state.failed) return <section className="feature-load-error" role="alert">
      <strong>파일 화면을 불러오지 못했습니다.</strong>
      <p>현재 작업본 원문은 아래에서 확인하고 복사할 수 있습니다.</p>
      <details><summary>{this.props.fileName} 원문</summary><textarea readOnly value={this.props.sourceText} aria-label={`${this.props.fileName} 원문 복구`} /></details>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}>다시 불러오기</button>
    </section>
    return this.props.children
  }
}
