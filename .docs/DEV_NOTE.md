# 수정해야 할 사항

## 문제 사항

1. Guest 메뉴 진입시 로딩 아이콘이 카드에 있지 않음
2. Uesr Create 시 Password 를 지정하고 Create 하는 문제
    - 현재 Supabase Auth API 에서 Password 를 지정하지 않고 User 를 생성하는 방법이 없음
    - 임시 방편으로 랜덤 패스워드를 생성하여 User Create 시 전달하도록 함
    - 근본적으로는 초대 링크를 통해 사용자가 스스로 비밀번호를 설정하도록 유도하는 방식이 필요
3. Password Reset 제대로 작동 하지 않음

## 해결 완료

1. External Link 에서 게스트가 활성화 되면 Active 로 바뀌지 않음
2. 일반 유저들의 Guest 등록 페이지에도 입장 시간이 나오게
3. Super Admin 페이지 상단 4개 메뉴 세로로 되어 있는데 일반 유저 UI처럼 가로로 바꾸기
