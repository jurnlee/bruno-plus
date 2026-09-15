import styled from 'styled-components';

const Wrapper = styled.div`
  .file-name-wrap {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .file-name {
    font-size: ${(props) => props.theme.font.size.sm};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-count {
    font-size: ${(props) => props.theme.font.size.xs};
    color: ${(props) => props.theme.colors.text.muted};
    flex-shrink: 0;
  }

  .link {
    color: ${(props) => props.theme.colors.text.yellow};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    font-size: ${(props) => props.theme.font.size.xs};
    flex-shrink: 0;
  }

  .error {
    color: ${(props) => props.theme.colors.text.danger};
    font-size: ${(props) => props.theme.font.size.xs};
    margin-top: 0.5rem;
    word-break: break-word;
  }

  .preview {
    margin-top: 0.5rem;
    max-height: 14rem;
    overflow: auto;
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.sm};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: ${(props) => props.theme.font.size.xs};
  }

  th,
  td {
    text-align: left;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid ${(props) => props.theme.input.border};
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th {
    position: sticky;
    top: 0;
    background-color: ${(props) => props.theme.bg};
    font-weight: 500;
  }

  .more-rows {
    padding: 0.25rem 0.5rem;
    color: ${(props) => props.theme.colors.text.muted};
  }
`;

export default Wrapper;
