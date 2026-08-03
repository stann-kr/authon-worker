-- 베뉴 현지 시각과 자정을 넘는 영업일 기준

ALTER TABLE venues
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Seoul';

ALTER TABLE venues
  ADD COLUMN opening_time TEXT NOT NULL DEFAULT '22:00'
  CHECK (
    length(opening_time) = 5
    AND substr(opening_time, 3, 1) = ':'
    AND opening_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND CAST(substr(opening_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(opening_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  );

ALTER TABLE venues
  ADD COLUMN closing_time TEXT NOT NULL DEFAULT '06:00'
  CHECK (
    length(closing_time) = 5
    AND substr(closing_time, 3, 1) = ':'
    AND closing_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND CAST(substr(closing_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(closing_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
    AND closing_time <> opening_time
  );
